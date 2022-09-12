export class PaxExtendedHeader {
  constructor(private keyword: PaxKeyword, private value: string) {}

  public length(encoder: TextEncoder): number {
    const base_length = this.keyword.length + encoder.encode(this.value).length + 3;
    let length_log10 = base_length.toString().length;
    if ((length_log10.toString().length + base_length).toString().length !== base_length.toString().length) {
      ++length_log10;
    }
    return length_log10 + base_length;
  }

  public toUint8Array(): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(`${this.length(encoder)} ${this.keyword}=${this.value}\n`);
  }
}

export enum PaxKeyword {
  size = 'size',
  path = 'path',
}
