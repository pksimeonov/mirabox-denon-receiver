/**
 * Pack the plugin folder into a .sdPlugin archive for Mirabox installation.
 * Mirabox expects .sdPlugin extension (not .streamDeckPlugin).
 * Output goes to release/ to avoid clashing with the source folder.
 */
import { createWriteStream, mkdirSync, unlinkSync, readdirSync, statSync, readFileSync } from "fs";
import { join, relative } from "path";
import { createDeflateRaw } from "zlib";

const pluginFolder = "com.pksimeonov.mirabox-denon.sdPlugin";
const outDir = "release";
const outFile = join(outDir, pluginFolder);

mkdirSync(outDir, { recursive: true });
try { unlinkSync(outFile); } catch {}

// Collect all files recursively
function walkDir(dir) {
	const results = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			results.push(...walkDir(full));
		} else {
			results.push(full);
		}
	}
	return results;
}

// Minimal ZIP file writer
const files = walkDir(pluginFolder);
const out = createWriteStream(outFile);

const centralDir = [];
let offset = 0;

function writeBytes(buf) {
	out.write(buf);
	offset += buf.length;
}

function dosDateTime(date) {
	const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { time, date: d };
}

function crc32(buf) {
	let crc = 0xFFFFFFFF;
	for (let i = 0; i < buf.length; i++) {
		crc ^= buf[i];
		for (let j = 0; j < 8; j++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
		}
	}
	return (crc ^ 0xFFFFFFFF) >>> 0;
}

function deflateSync(buf) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		const deflater = createDeflateRaw();
		deflater.on("data", c => chunks.push(c));
		deflater.on("end", () => resolve(Buffer.concat(chunks)));
		deflater.on("error", reject);
		deflater.end(buf);
	});
}

async function main() {
	for (const filePath of files) {
		const data = readFileSync(filePath);
		const name = relative(".", filePath).replace(/\\/g, "/");
		const nameBytes = Buffer.from(name);
		const crc = crc32(data);
		const compressed = await deflateSync(data);
		const dt = dosDateTime(statSync(filePath).mtime);

		const localHeaderOffset = offset;

		// Local file header
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);  // signature
		local.writeUInt16LE(20, 4);           // version needed
		local.writeUInt16LE(0, 6);            // flags
		local.writeUInt16LE(8, 8);            // compression: deflate
		local.writeUInt16LE(dt.time, 10);
		local.writeUInt16LE(dt.date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28);           // extra length

		writeBytes(local);
		writeBytes(nameBytes);
		writeBytes(compressed);

		// Central directory entry
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);         // version made by
		central.writeUInt16LE(20, 6);         // version needed
		central.writeUInt16LE(0, 8);          // flags
		central.writeUInt16LE(8, 10);         // compression: deflate
		central.writeUInt16LE(dt.time, 12);
		central.writeUInt16LE(dt.date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt16LE(0, 30);         // extra length
		central.writeUInt16LE(0, 32);         // comment length
		central.writeUInt16LE(0, 34);         // disk number
		central.writeUInt16LE(0, 36);         // internal attrs
		central.writeUInt32LE(0, 38);         // external attrs
		central.writeUInt32LE(localHeaderOffset, 42);

		centralDir.push(Buffer.concat([central, nameBytes]));
	}

	const centralDirOffset = offset;
	for (const entry of centralDir) {
		writeBytes(entry);
	}
	const centralDirSize = offset - centralDirOffset;

	// End of central directory
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(centralDir.length, 8);
	eocd.writeUInt16LE(centralDir.length, 10);
	eocd.writeUInt32LE(centralDirSize, 12);
	eocd.writeUInt32LE(centralDirOffset, 16);
	eocd.writeUInt16LE(0, 20);
	writeBytes(eocd);

	out.end(() => {
		console.log(`Packed ${files.length} files: ${outFile}`);
	});
}

main().catch(e => { console.error(e); process.exit(1); });
