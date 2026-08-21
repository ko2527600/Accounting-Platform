import { BetaAnalyticsDataClient } from '@google-analytics/data';

function isConfigured(): boolean {
  return !!(
    process.env.GA_PROPERTY_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

function getClient(): BetaAnalyticsDataClient {
  const privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  return new BetaAnalyticsDataClient({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
  });
}

export interface AnalyticsOverview {
  configured: boolean;
  dateRange: string;
  totalUsers: number;
  newUsers: number;
  sessions: number;
  pageViews: number;
  avgSessionDuration: number;
  bounceRate: number;
  topPages: { page: string; views: number }[];
  topCountries: { country: string; users: number }[];
  topDevices: { device: string; sessions: number }[];
  activeUsers: number;
}

export async function getAnalyticsOverview(days: number = 28): Promise<AnalyticsOverview> {
  if (!isConfigured()) {
    return {
      configured: false,
      dateRange: `last${days}days`,
      totalUsers: 0,
      newUsers: 0,
      sessions: 0,
      pageViews: 0,
      avgSessionDuration: 0,
      bounceRate: 0,
      topPages: [],
      topCountries: [],
      topDevices: [],
      activeUsers: 0,
    };
  }

  const client = getClient();
  const propertyId = process.env.GA_PROPERTY_ID!;
  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

  const [overviewRes, topPagesRes, topCountriesRes, topDevicesRes, realtimeRes] = await Promise.all([
    // Core metrics
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [dateRange],
      metrics: [
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
      ],
    }),
    // Top pages
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [dateRange],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }),
    // Top countries
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [dateRange],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'totalUsers' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 10,
    }),
    // Devices
    client.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [dateRange],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    }),
    // Realtime active users
    client.runRealtimeReport({
      property: `properties/${propertyId}`,
      metrics: [{ name: 'activeUsers' }],
    }),
  ]);

  const row = overviewRes[0]?.rows?.[0];
  const metrics = row?.metricValues ?? [];

  return {
    configured: true,
    dateRange: `last${days}days`,
    totalUsers: Number(metrics[0]?.value ?? 0),
    newUsers: Number(metrics[1]?.value ?? 0),
    sessions: Number(metrics[2]?.value ?? 0),
    pageViews: Number(metrics[3]?.value ?? 0),
    avgSessionDuration: Math.round(Number(metrics[4]?.value ?? 0)),
    bounceRate: Math.round(Number(metrics[5]?.value ?? 0) * 100) / 100,
    topPages: (topPagesRes[0]?.rows ?? []).map((r) => ({
      page: r.dimensionValues?.[0]?.value ?? '',
      views: Number(r.metricValues?.[0]?.value ?? 0),
    })),
    topCountries: (topCountriesRes[0]?.rows ?? []).map((r) => ({
      country: r.dimensionValues?.[0]?.value ?? '',
      users: Number(r.metricValues?.[0]?.value ?? 0),
    })),
    topDevices: (topDevicesRes[0]?.rows ?? []).map((r) => ({
      device: r.dimensionValues?.[0]?.value ?? '',
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
    })),
    activeUsers: Number(realtimeRes[0]?.rows?.[0]?.metricValues?.[0]?.value ?? 0),
  };
}

export { isConfigured };
