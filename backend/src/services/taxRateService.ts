import { prisma } from '../config/db';
import * as taxRateRepository from '../repository/taxRateRepository';
import { TaxRateRecord, CreateTaxRateData, TaxRateComponent } from '../repository/taxRateRepository';

export class TaxRateServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'TaxRateServiceError';
    this.statusCode = statusCode;
  }
}

function validateRate(rate: number): void {
  if (typeof rate !== 'number' || Number.isNaN(rate) || rate <= 0 || rate > 1) {
    throw new TaxRateServiceError('Tax rate must be a number greater than 0 and less than or equal to 1 (e.g. 0.15 for 15%).', 400);
  }
}

function validateDateRange(effectiveFrom: Date, effectiveTo?: Date | null): void {
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new TaxRateServiceError('effectiveTo must be after effectiveFrom.', 400);
  }
}

/**
 * Validates an optional layered breakdown (e.g. Ghana's VAT 15% + NHIL 2.5%
 * + GETFund 2.5%) and confirms its components sum to the parent `rate` -
 * the parent rate stays the single source of truth for tax calculation, the
 * components are purely a labeled breakdown, so an inconsistent breakdown
 * (one that doesn't add up) is rejected rather than silently accepted.
 */
function validateComponents(components: unknown, parentRate: number): TaxRateComponent[] | null {
  if (components === undefined || components === null) return null;
  if (!Array.isArray(components) || components.length === 0) {
    throw new TaxRateServiceError('components must be a non-empty array of {name, rate} when provided.', 400);
  }

  let sum = 0;
  const validated: TaxRateComponent[] = components.map((c: any, i: number) => {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) {
      throw new TaxRateServiceError(`Component ${i + 1}: name is required.`, 400);
    }
    const rate = Number(c.rate);
    if (typeof rate !== 'number' || Number.isNaN(rate) || rate <= 0 || rate > 1) {
      throw new TaxRateServiceError(`Component ${i + 1} ("${c.name}"): rate must be a number greater than 0 and less than or equal to 1.`, 400);
    }
    sum += rate;
    return { name: c.name.trim(), rate };
  });

  if (Math.abs(sum - parentRate) > 0.0005) {
    throw new TaxRateServiceError(
      `Component rates must sum to the tax rate's total (${(parentRate * 100).toFixed(2)}%), but they sum to ${(sum * 100).toFixed(2)}%.`,
      400
    );
  }

  return validated;
}

export async function listTaxRates(tenantId: string): Promise<TaxRateRecord[]> {
  return taxRateRepository.listTaxRates(prisma, tenantId);
}

export async function getTaxRateById(tenantId: string, id: string): Promise<TaxRateRecord | null> {
  return taxRateRepository.getTaxRateById(prisma, tenantId, id);
}

export async function createTaxRate(tenantId: string, input: any): Promise<TaxRateRecord> {
  const { name, code, rate, description, accountId, isActive, effectiveFrom, effectiveTo, components } = input;

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new TaxRateServiceError('Tax rate name is required.', 400);
  }
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new TaxRateServiceError('Tax rate code is required.', 400);
  }
  const numericRate = Number(rate);
  validateRate(numericRate);
  const validatedComponents = validateComponents(components, numericRate);
  if (!effectiveFrom) {
    throw new TaxRateServiceError('effectiveFrom date is required.', 400);
  }
  const from = new Date(effectiveFrom);
  const to = effectiveTo ? new Date(effectiveTo) : null;
  validateDateRange(from, to);

  const existingCode = await taxRateRepository.getTaxRateByCode(prisma, tenantId, code.trim());
  if (existingCode) {
    throw new TaxRateServiceError(`Tax rate code "${code.trim()}" already exists.`, 409);
  }

  const data: CreateTaxRateData = {
    name,
    code,
    rate: numericRate,
    description,
    accountId,
    isActive,
    effectiveFrom: from,
    effectiveTo: to,
    components: validatedComponents,
  };

  return taxRateRepository.createTaxRate(prisma, tenantId, data);
}

export async function updateTaxRate(tenantId: string, id: string, input: any): Promise<TaxRateRecord> {
  const existing = await taxRateRepository.getTaxRateById(prisma, tenantId, id);
  if (!existing) {
    throw new TaxRateServiceError(`Tax rate with ID "${id}" not found.`, 404);
  }

  const data: Partial<CreateTaxRateData> = {};

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new TaxRateServiceError('Tax rate name cannot be empty.', 400);
    data.name = input.name;
  }
  if (input.code !== undefined) {
    if (!input.code.trim()) throw new TaxRateServiceError('Tax rate code cannot be empty.', 400);
    if (input.code.trim() !== existing.code) {
      const existingCode = await taxRateRepository.getTaxRateByCode(prisma, tenantId, input.code.trim());
      if (existingCode) {
        throw new TaxRateServiceError(`Tax rate code "${input.code.trim()}" already exists.`, 409);
      }
    }
    data.code = input.code;
  }
  if (input.rate !== undefined) {
    const numericRate = Number(input.rate);
    validateRate(numericRate);
    data.rate = numericRate;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.accountId !== undefined) data.accountId = input.accountId;
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  const effectiveRate = data.rate !== undefined ? data.rate : Number(existing.rate);
  if (input.components !== undefined) {
    data.components = validateComponents(input.components, effectiveRate);
  } else if (data.rate !== undefined && existing.components) {
    // The rate is changing but the caller didn't also send new components -
    // the existing breakdown would no longer sum to the new total, so require
    // an explicit update rather than silently leaving an inconsistent breakdown.
    throw new TaxRateServiceError(
      'This tax rate has a components breakdown - update components together with rate, or clear components (set to null) first.',
      400
    );
  }

  const newFrom = input.effectiveFrom !== undefined ? new Date(input.effectiveFrom) : existing.effectiveFrom;
  const newTo = input.effectiveTo !== undefined ? (input.effectiveTo ? new Date(input.effectiveTo) : null) : existing.effectiveTo;
  if (input.effectiveFrom !== undefined || input.effectiveTo !== undefined) {
    validateDateRange(newFrom, newTo);
    data.effectiveFrom = newFrom;
    data.effectiveTo = newTo;
  }

  const updated = await taxRateRepository.updateTaxRate(prisma, tenantId, id, data);
  if (!updated) {
    throw new TaxRateServiceError(`Failed to update tax rate with ID "${id}".`, 500);
  }
  return updated;
}

export async function deleteTaxRate(tenantId: string, id: string): Promise<void> {
  const existing = await taxRateRepository.getTaxRateById(prisma, tenantId, id);
  if (!existing) {
    throw new TaxRateServiceError(`Tax rate with ID "${id}" not found.`, 404);
  }

  const usageCount = await taxRateRepository.countInvoicesUsingTaxRate(prisma, tenantId, id);
  if (usageCount > 0) {
    throw new TaxRateServiceError(
      `Cannot delete tax rate "${existing.name}" (${existing.code}) because it is used by ${usageCount} invoice(s). Deactivate it instead.`,
      400
    );
  }

  await taxRateRepository.deleteTaxRate(prisma, tenantId, id);
}

/**
 * Finds the tenant's tax rate to apply to an invoice dated `issueDate`, when
 * the caller didn't pass an explicit taxRateId. Returns null if no active
 * rate exists (caller falls back to zero tax rather than guessing).
 * Throws if more than one active rate covers the date and the caller must
 * pick explicitly - never silently applies the "wrong" one of several.
 */
export async function resolveDefaultTaxRate(tenantId: string, issueDate: Date): Promise<TaxRateRecord | null> {
  const candidates = await taxRateRepository.findActiveTaxRateForDate(prisma, tenantId, issueDate);
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    throw new TaxRateServiceError(
      'Multiple active tax rates apply to this date - please specify taxRateId explicitly.',
      400
    );
  }
  return candidates[0];
}
