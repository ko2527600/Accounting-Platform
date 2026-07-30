import type { AxiosResponse } from "axios";

/** Triggers a browser download from an Axios blob response (responseType: "blob"). */
export function downloadBlobResponse(response: AxiosResponse<Blob>, filename: string): void {
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
