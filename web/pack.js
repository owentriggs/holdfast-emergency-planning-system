// The single-file format the computer and the phone app swap (see src/main/phone.js):
//   "HFPK1\n" | header length (uint32 BE) | header JSON | blobs, with header.blobs = { name: [offset, length] }
const MAGIC = 'HFPK1\n';

// Reads only the header; blobs are sliced from the file when needed, so a large vault is never held in memory at once.
export async function readPack(file) {
  const top = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (new TextDecoder().decode(top.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('This is not a Holdfast phone file');
  const hlen = new DataView(top.buffer).getUint32(MAGIC.length);
  const start = MAGIC.length + 4 + hlen;
  const header = JSON.parse(await file.slice(MAGIC.length + 4, start).text());
  const blob = (name) => {
    const at = header.blobs[name];
    return at ? file.slice(start + at[0], start + at[0] + at[1]) : null;
  };
  return { header, blob };
}

// parts: [[name, Blob | Uint8Array]]. Returns a Blob, built without copying the parts into one buffer.
export function writePack(header, parts) {
  const blobs = {};
  let offset = 0;
  for (const [name, data] of parts) {
    const len = data.size ?? data.length;
    blobs[name] = [offset, len];
    offset += len;
  }
  const head = new TextEncoder().encode(JSON.stringify({ ...header, blobs }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, head.length);
  return new Blob([MAGIC, len, head, ...parts.map(([, d]) => d)], { type: 'application/octet-stream' });
}
