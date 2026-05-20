declare const __APP_DATA_MODE__: string;
declare const __GOOGLE_AUTH_ENABLED__: boolean;

export const dataMode = __APP_DATA_MODE__ === 'mock' ? 'mock' : 'production';
export const isMockMode = dataMode === 'mock';
export const isGoogleAuthEnabled = Boolean(__GOOGLE_AUTH_ENABLED__);
