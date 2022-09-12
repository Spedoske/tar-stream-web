import { ReadableStream } from 'node:stream/web';
import Tarball from '../src/';
import { generate_prefix_and_name } from '../src/tar';

const fs = require('fs');

test('Test split prefix and name', () => {
    const total_length = (...args: string[]) => {
        let length = 0;
        args = args.filter((s) => s.length !== 0);
        for (let arg of args) {
            length += arg.length;
        }
        return length + args.length - 1;
    }
    const encoder = new TextEncoder()
    const max_prefix_length = 155 - 1;
    const max_name_length = 100 - 1;
    for (let i of [0, 1, 95, 96, 97, 98, 99, 100, 101, 150, 151, 152, 153, 154, 155]) {
        let path_i = 'a'.repeat(i);
        for (let j = 0; j <= 155; ++j) {
            let part_j = 'b'.repeat(j);
            let path_j = path_i === "" || part_j === "" ? part_j : path_i + '/' + part_j;
            for (let k = 0; k <= 155; ++k) {
                let part_k = 'c'.repeat(k)
                let path_k = path_j === "" || part_k === "" ? part_k : path_j + '/' + part_k;
                if (path_k === "") {
                    continue;
                }
                try {
                    expect(generate_prefix_and_name(path_k)).toStrictEqual((() => {
                        if (path_k.length <= max_name_length) {
                            return [new Uint8Array(), encoder.encode(path_k)];
                        }
                        if (path_i.length !== 0 && path_i.length <= max_prefix_length && total_length(part_j , part_k) <= max_name_length) {
                            return [encoder.encode(path_i), encoder.encode(part_j + '/' + part_k)];
                        }
                        if (total_length(path_i , part_j) <= max_prefix_length && part_k.length <= max_name_length) {
                            return [encoder.encode(path_i === "" ? part_j : path_i + '/' + part_j), encoder.encode(part_k)];
                        }
                        return null;
                    })())
                } catch (e) {
                    console.log(i, j, k)
                    throw e;
                }
            }
        }
    }
});


function ReadableBufferStream(chunkSize = 1024*1024) {
    let readIndex = 0;
    return new ReadableStream({
        pull(controller) {
            controller.enqueue(new Uint8Array(chunkSize));
            readIndex += chunkSize;
            if (readIndex >= 9*1024*1024*1024) {
                controller.close();
            }
        },
    });
}

const tar = new Tarball([{
    name: '01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789',
    size: 9*1024*1024*1024,
    mtime: new Date(0o14307600623*1000),
    content: ReadableBufferStream()
}]);

test('Write big file with pax', ()=>{
    let reader = tar.stream.getReader();
    (async()=>{
        await new Promise((resolve)=>{
            fs.writeFile('./1.tar', new Uint8Array(), resolve);
        })
        while(true){
            let {value, done} = await reader.read();
            if(done){
                break;
            }
            await new Promise((resolve)=>{
                fs.appendFile('./1.tar', value, resolve);
            })
        }
    })()
})

