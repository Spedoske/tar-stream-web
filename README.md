# tar-stream-web
A library to create a tar archive from file streams. Support both browser and node.js.

## Usage
```typescript
import Tarball from 'tar-stream-web';
let tape = new Tar([{
    name: 'path_1/path_2/file',
    size: 4,
    content: '1234'
}]);

// tape.stream is a ReadableStream
console.log(tape.stream);
```
