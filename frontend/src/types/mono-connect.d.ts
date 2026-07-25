declare module '@mono.co/connect.js' {
  interface MonoConnectConfig {
    key: string;
    data?: {
      customer?: {
        id?: string;
        name?: string;
        email?: string;
        identity?: { type: string; number: string };
      };
    };
    onSuccess?: (response: { code: string }) => void;
    onClose?: () => void;
    onLoad?: () => void;
  }

  class MonoConnect {
    constructor(config: MonoConnectConfig);
    setup(): void;
    open(): void;
  }

  export default MonoConnect;
}
