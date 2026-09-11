/* eslint-disable no-console */

export const logger = {
  info: (msg: string) => console.error(`[info] ${msg}`),
  warn: (msg: string) => console.error(`[warn] ${msg}`),
  error: (msg: string) => console.error(`[error] ${msg}`),
};
