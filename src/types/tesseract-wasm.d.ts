declare module 'tesseract-wasm' {
  export function createOCRClient(opts?: any): any;
}

declare module 'tesseract-wasm/node' {
  export function loadWasmBinary(): Promise<Uint8Array>;
}
