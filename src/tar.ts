/* A tar archive consists of 512-byte blocks.
   Each file in the archive has a header block followed by 0+ data blocks.
   Two blocks of NUL bytes indicate the end of the archive.  */

/* The fields of header blocks:
   All strings are stored as ISO 646 (approximately ASCII) strings.

   Fields are numeric unless otherwise noted below; numbers are ISO 646
   representations of octal numbers, with leading zeros as needed.

   linkname is only valid when typeflag==LNKTYPE.  It doesn't use prefix;
   files that are links to pathnames >100 chars long can not be stored
   in a tar archive.

   If typeflag=={LNKTYPE,SYMTYPE,DIRTYPE} then size must be 0.

   devmajor and devminor are only valid for typeflag=={BLKTYPE,CHRTYPE}.

   chksum contains the sum of all 512 bytes in the header block,
   treating each byte as an 8-bit unsigned value and treating the
   8 bytes of chksum as blank characters.

   uname and gname are used in preference to uid and gid, if those
   names exist locally.

   Field Name   Byte Offset     Length in Bytes Field Type
   name         0               100             NUL-terminated if NUL fits
   mode         100             8
   uid          108             8
   gid          116             8
   size         124             12
   mtime        136             12
   chksum       148             8
   typeflag     156             1               see below
   linkname     157             100             NUL-terminated if NUL fits
   magic        257             6               must be TMAGIC (NUL term.)
   version      263             2               must be TVERSION
   uname        265             32              NUL-terminated
   gname        297             32              NUL-terminated
   devmajor     329             8
   devminor     337             8
   prefix       345             155             NUL-terminated if NUL fits

   If the first character of prefix is '\0', the file name is name;
   otherwise, it is prefix/name.  Files whose pathnames don't fit in that
   length can not be stored in a tar archive.  */

import { PaxExtendedHeader, PaxKeyword } from './pax';

if (typeof ReadableStream === 'undefined') {
  const globalVar: any =
    (typeof globalThis !== 'undefined' && globalThis) ||
    (typeof self !== 'undefined' && self) ||
    (typeof global !== 'undefined' && global) ||
    {};
  Reflect.set(globalVar, 'ReadableStream', require('node:stream/web').ReadableStream);
}

const max_prefix_length = 155 - 1;
const max_name_length = 100 - 1;

enum TarEntryType {
  REGTYPE = '0',
  LNKTYPE = '1',
  SYMTYPE = '2',
  CHRTYPE = '3',
  BLKTYPE = '4',
  DIRTYPE = '5',
  FIFOTYPE = '6',
  CONTTYPE = '7',
  EXTHEADER = 'x',
  GEXTHEADER = 'g',
}

interface TarHeaderBlockParams {
  name: string;
  mode?: number;
  uid?: number;
  gid?: number;
  size: number;
  mtime?: Date;
  typeflag?: TarEntryType;
  linkname?: string;
  uname?: string;
  gname?: string;
  devmajor?: string;
  devminor?: string;
  content?: ReadableStream | Uint8Array;
}

// https://stackoverflow.com/a/43666199
function and(v1: number, v2: number) {
  const hi = 0x80000000;
  const low = 0x7fffffff;
  const hi1 = ~~(v1 / hi);
  const hi2 = ~~(v2 / hi);
  const low1 = v1 & low;
  const low2 = v2 & low;
  const h = hi1 & hi2;
  const l = low1 & low2;
  return h * hi + l;
}

// https://stackoverflow.com/a/59902638
function concat(arrays: Uint8Array[], total_length: number) {
  let result = new Uint8Array(total_length);

  // for each array - copy it over result
  // next array is copied right after the previous one
  let length = 0;
  for (let index = 0; index < arrays.length; ++index) {
    result.set(arrays[index], length);
    length += arrays[index].length;
    if (index !== arrays.length - 1) {
      result.set(['/'.charCodeAt(0)], length);
      ++length;
    }
  }

  return result;
}

function generate_prefix_and_name(path: string): [Uint8Array, Uint8Array] | null {
  const encoder = new TextEncoder();
  const split_name = path.split('/').map((str) => encoder.encode(str));
  const split_name_length_sum = new Array<number>(split_name.length).fill(0);
  split_name_length_sum.forEach((value, index, array) => {
    if (index === 0) {
      array[index] = split_name[index].length;
    } else {
      array[index] = array[index - 1] + split_name[index].length;
    }
  });

  if (split_name_length_sum.length === 1 && split_name_length_sum.length > max_name_length) {
    return null;
  }

  if (split_name_length_sum[split_name_length_sum.length - 1] + split_name_length_sum.length - 1 <= max_name_length) {
    return [new Uint8Array(), encoder.encode(path)];
  }

  for (let i = 1; i <= split_name.length - 1; ++i) {
    const prefix_length = split_name_length_sum[i - 1] + (i - 1);
    const name_length =
      split_name_length_sum[split_name_length_sum.length - 1] +
      split_name_length_sum.length -
      1 -
      split_name_length_sum[i - 1] -
      i;
    if (prefix_length <= max_prefix_length && name_length <= max_name_length) {
      return [concat(split_name.slice(0, i), prefix_length), concat(split_name.slice(i), name_length)];
    }
  }
  return null;
}

function padding_to_512(buf: Uint8Array): Uint8Array {
  if (buf.length % 512 === 0) {
    return buf;
  }
  let length = Math.ceil(buf.length / 512) * 512;
  let new_buf = new Uint8Array(length);
  new_buf.set(buf);
  return new_buf;
}

function ReadableBufferStream(bytes: Uint8Array, chunkSize = 512) {
  let readIndex = 0;
  return new ReadableStream({
    start(controller) {
      if (readIndex === bytes.length) {
        controller.close();
      }
    },
    pull(controller) {
      controller.enqueue(padding_to_512(bytes.subarray(readIndex, readIndex + chunkSize)));
      readIndex += chunkSize;
      if (readIndex >= bytes.length) {
        controller.close();
      }
    },
  });
}

function ReadableConcatStream(first: ReadableStream, second: ReadableStream): ReadableStream {
  let firstReader = first.getReader();
  let secondReader = second.getReader();
  let readSecond = false;
  return new ReadableStream({
    pull(controller) {
      return (async () => {
        if (!readSecond) {
          let { value, done } = await firstReader.read();
          if (!done) {
            controller.enqueue(value);
          }
          readSecond = done;
        }
        if (readSecond) {
          let { value, done } = await secondReader.read();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        }
      })();
    },
  });
}

class TarHeaderBlock {
  pax_headers: PaxExtendedHeader[];
  name: Uint8Array;
  prefix: Uint8Array;
  mode: Uint8Array;
  uid: Uint8Array;
  gid: Uint8Array;
  size: Uint8Array;
  mtime: Uint8Array;
  typeflag: Uint8Array;
  linkname: Uint8Array;
  magic: Uint8Array;
  version: Uint8Array;
  uname: Uint8Array;
  gname: Uint8Array;
  devmajor: Uint8Array;
  devminor: Uint8Array;
  content: ReadableStream;

  constructor(param: TarHeaderBlockParams) {
    this.pax_headers = [];
    const encoder = new TextEncoder();
    console.assert(param.name !== '');
    // we do not support create directory now
    console.assert(!param.name.endsWith('/'));
    let prefix_and_name = generate_prefix_and_name(param.name);
    this.name = new Uint8Array(100);
    this.prefix = new Uint8Array(155);
    if (!prefix_and_name) {
      this.pax_headers.push(new PaxExtendedHeader(PaxKeyword.path, param.name));
      // name_prefix = '@PathCut/_pc_root/'
      const name_prefix = [
        0x40, 0x50, 0x61, 0x74, 0x68, 0x43, 0x75, 0x74, 0x2f, 0x5f, 0x70, 0x63, 0x5f, 0x72, 0x6f, 0x6f, 0x74, 0x2f,
      ];
      let name_bin = encoder.encode(param.name);
      name_bin = name_bin.slice(0, max_name_length - name_prefix.length);
      this.name.set(name_prefix);
      this.name.set(name_bin, name_prefix.length);
    } else {
      this.prefix.set(prefix_and_name[0]);
      this.name.set(prefix_and_name[1]);
    }

    this.mode = new Uint8Array(8);
    param.mode = param.mode || 0o777;
    console.assert(Number.isInteger(param.mode));
    this.mode.set(encoder.encode((param.mode & 0o7777777).toString(8).padStart(7, '0')));

    this.uid = new Uint8Array(8);
    param.uid = param.uid || 0;
    console.assert(Number.isInteger(param.uid));
    this.uid.set(encoder.encode((param.uid & 0o7777777).toString(8).padStart(7, '0')));

    this.gid = new Uint8Array(8);
    param.gid = param.gid || 0;
    console.assert(Number.isInteger(param.gid));
    this.gid.set(encoder.encode((param.gid & 0o7777777).toString(8).padStart(7, '0')));

    this.size = new Uint8Array(12);
    param.size = param.size || 0;
    console.assert(Number.isInteger(param.size));
    this.size.set(encoder.encode(and(param.size, 0o77777777777).toString(8).padStart(11, '0')));
    if (param.size > 0o77777777777) {
      this.pax_headers.push(new PaxExtendedHeader(PaxKeyword.size, param.size.toString()));
    }

    this.mtime = new Uint8Array(12);
    param.mtime = param.mtime || new Date(0);
    this.mtime.set(
      encoder.encode(
        and(Math.round(param.mtime.getTime() / 1000), 0o77777777777)
          .toString(8)
          .padStart(11, '0'),
      ),
    );

    this.typeflag = encoder.encode(param.typeflag || TarEntryType.REGTYPE);
    this.linkname = new Uint8Array(100);
    this.magic = new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0x00]);
    this.version = new Uint8Array([0x30, 0x30]);

    this.uname = new Uint8Array(32);
    if (param.uname) {
      this.uname.set(encoder.encode(param.uname).slice(0, 31));
    }

    this.gname = new Uint8Array(32);
    if (param.gname) {
      this.gname.set(encoder.encode(param.gname).slice(0, 31));
    }

    this.devmajor = new Uint8Array(8);
    if (param.devmajor) {
      this.devmajor.set(encoder.encode(param.devmajor).slice(0, 7));
    }

    this.devminor = new Uint8Array(8);
    if (param.devminor) {
      this.devminor.set(encoder.encode(param.devminor).slice(0, 7));
    }

    if (param.content === undefined) {
      this.content = ReadableBufferStream(new Uint8Array());
    } else if (param.content instanceof Uint8Array) {
      this.content = ReadableBufferStream(param.content);
    } else {
      this.content = param.content;
    }
  }

  header(encoder: TextEncoder): Uint8Array {
    let buf = new Uint8Array(512);
    buf.set(this.name, 0);
    buf.set(this.mode, 100);
    buf.set(this.uid, 108);
    buf.set(this.gid, 116);
    buf.set(this.size, 124);
    buf.set(this.mtime, 136);
    buf.set(this.typeflag, 156);
    buf.set(this.linkname, 157);
    buf.set(this.magic, 257);
    buf.set(this.version, 263);
    buf.set(this.uname, 265);
    buf.set(this.gname, 297);
    buf.set(this.devmajor, 329);
    buf.set(this.devminor, 337);
    buf.set(this.prefix, 345);
    let sum = Array.from(buf).reduce((total, current) => total + current, 0) + ' '.charCodeAt(0) * 8;
    buf.set(encoder.encode(sum.toString(8).padStart(6, '0')), 148);
    buf.set([0x00, 0x20], 148 + 6);
    return buf;
  }

  whole_block(): ReadableStream {
    return ReadableConcatStream(this.header_with_pax(), this.content);
  }

  header_with_pax(): ReadableStream {
    const encoder = new TextEncoder();
    const header = this.header(encoder);
    let pax_block_stream = null as null | ReadableStream;
    if (this.pax_headers.length !== 0) {
      const total_pax_size = this.pax_headers.reduce((size, header) => size + header.length(encoder), 0);
      const pax_buffer = new Uint8Array(total_pax_size);
      let readIndex = 0;
      for (let pax_header_entry of this.pax_headers) {
        const buf = pax_header_entry.toUint8Array();
        pax_buffer.set(buf, readIndex);
        readIndex += buf.length;
      }
      pax_block_stream = new TarHeaderBlock({
        name: 'PaxHeader/@PaxHeader',
        size: total_pax_size,
        content: pax_buffer,
        typeflag: TarEntryType.EXTHEADER,
      }).whole_block();
    }
    return pax_block_stream
      ? ReadableConcatStream(pax_block_stream, ReadableBufferStream(header))
      : ReadableBufferStream(header);
  }
}

export class Tarball {
  stream: ReadableStream;

  constructor(param: TarHeaderBlockParams[]) {
    console.assert(param.length > 0);
    let streams = param.map((p) => new TarHeaderBlock(p).whole_block());
    this.stream = streams[0];
    for (let i = 1; i < streams.length; ++i) {
      this.stream = ReadableConcatStream(this.stream, streams[i]);
    }
    this.stream = ReadableConcatStream(this.stream, ReadableBufferStream(new Uint8Array(1024)));
  }
}

export { generate_prefix_and_name };
