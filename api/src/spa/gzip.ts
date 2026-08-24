/**
 * Gzip for fat SPA photos. Legacy rows are still raw JSON arrays.
 * Detect gzip via 1f 8b magic so both TEXT and BLOB D1 values work.
 */

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

function isGzipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    bytes[0] === GZIP_MAGIC_0 &&
    bytes[1] === GZIP_MAGIC_1
  );
}

function toUint8Array(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  // D1 sometimes returns blobs from another realm, or as a number[].
  if (Array.isArray(raw) && raw.every((n) => typeof n === "number")) {
    return Uint8Array.from(raw);
  }
  if (
    raw &&
    typeof raw === "object" &&
    Object.prototype.toString.call(raw) === "[object ArrayBuffer]"
  ) {
    return new Uint8Array(raw as ArrayBuffer);
  }
  if (
    raw &&
    typeof raw === "object" &&
    "data" in raw &&
    Array.isArray((raw as { data: unknown }).data)
  ) {
    return Uint8Array.from((raw as { data: number[] }).data);
  }
  return null;
}

/** latin1/binary string from D1 TEXT affinity. */
function binaryStringToBytes(raw: string): Uint8Array {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i) & 0xff;
  }
  return bytes;
}

export async function gzipUtf8(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipUtf8(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Blob([copy])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

export async function encodeSpaPricesColumn(json: string): Promise<Uint8Array> {
  return gzipUtf8(json);
}

export async function decodeSpaPricesColumn(
  raw: unknown,
): Promise<string | null> {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return raw;
    const bytes = binaryStringToBytes(raw);
    if (isGzipBytes(bytes)) return gunzipUtf8(bytes);
    return raw;
  }
  const bytes = toUint8Array(raw);
  if (!bytes) {
    throw new Error(
      `SPA prices column is ${Object.prototype.toString.call(raw)}; cannot decode`,
    );
  }
  if (isGzipBytes(bytes)) return gunzipUtf8(bytes);
  return new TextDecoder().decode(bytes);
}
