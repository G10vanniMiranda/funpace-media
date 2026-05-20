declare const __APP_DATA_MODE__: string;

export const dataMode = __APP_DATA_MODE__ === 'mock' ? 'mock' : 'production';
export const isMockMode = dataMode === 'mock';
