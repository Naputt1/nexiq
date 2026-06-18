declare module "ws" {
  class WebSocket {
    constructor(url: string);
    on(event: string, callback: (...args: any[]) => void): void;
    terminate(): void;
    close(): void;
  }
  export { WebSocket };
}
