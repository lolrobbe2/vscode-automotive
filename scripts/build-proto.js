const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const srcDir = path.join(cwd, 'src');
const protoDir = path.join(srcDir, 'aap_protobuf');
const outDir = path.join(srcDir, 'generated');

fs.mkdirSync(outDir, { recursive: true });

const protocPath = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'grpc_tools_node_protoc.cmd' : 'grpc_tools_node_protoc');
const pluginPath = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'protoc-gen-ts_proto.cmd' : 'protoc-gen-ts_proto');

function getRelativeProtoFiles(dir, baseDir = dir) {
    let results = [];
    const list = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of list) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            results = results.concat(getRelativeProtoFiles(fullPath, baseDir));
        } else if (item.isFile() && item.name.endsWith('.proto')) {
            const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
            results.push(relativePath);
        }
    }
    return results;
}

const relativeFiles = getRelativeProtoFiles(protoDir);

if (relativeFiles.length === 0) {
    console.error('No .proto files found in src/aap_protobuf');
    process.exit(1);
}

const tsProtoOptions = [
    'env=node',
    'esModuleInterop=true',
    'outputServices=false'
].join(',');

console.log(`Compiling ${relativeFiles.length} files individually with ts-proto...`);

let successCount = 0;

for (const file of relativeFiles) {
    // Include both srcDir and protoDir so both 'aap_protobuf/...' and relative imports work
    const command = `"${protocPath}" --plugin=protoc-gen-ts_proto="${pluginPath}" --ts_proto_opt=${tsProtoOptions} --ts_proto_out="${outDir}" -I "${protoDir}" -I "${srcDir}" "${file}"`;
    try {
        execSync(command, { cwd: protoDir, stdio: 'pipe' });
        successCount++;
        process.stdout.write(`\rCompiled [${successCount}/${relativeFiles.length}] ${file}`);
    } catch (err) {
        console.error(`\n\nFailed on file: ${file}`);
        if (err.stderr) {
            console.error('\nprotoc error output:\n' + err.stderr.toString());
        }
        process.exit(1);
    }
}

console.log(`\nSuccessfully compiled all ${successCount} .proto files to ${outDir}`);