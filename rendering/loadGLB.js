function readString(buffer, offset, length) {
    return new TextDecoder().decode(new Uint8Array(buffer, offset, length));
}

function getAccessorData(json, bufferData, accessorIndex) {
    const accessor = json.accessors[accessorIndex];
    const view = json.bufferViews[accessor.bufferViewIndex ?? accessor.bufferView];
    const byteOffset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

    const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
    const count = accessor.count * componentCount;

    if (accessor.componentType === 5126) return new Float32Array(bufferData, byteOffset, count);
    if (accessor.componentType === 5123) return new Uint16Array(bufferData, byteOffset, count);
    if (accessor.componentType === 5125) return new Uint32Array(bufferData, byteOffset, count);
    return null;
}

function decodeImage(gl, mimeType, imageData) {
    return new Promise(resolve => {
        const blob = new Blob([imageData], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            const pow2 = (v) => (v & (v - 1)) === 0;
            if (pow2(image.width) && pow2(image.height)) {
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            } else {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            URL.revokeObjectURL(url);
            resolve(texture);
        };
        image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        image.src = url;
    });
}

// Accepts either a URL string or a pre-fetched ArrayBuffer.
export async function loadGLB(glbPathOrBuffer, gl = null) {
    let arrayBuffer;
    if (typeof glbPathOrBuffer === 'string') {
        const url = new URL(glbPathOrBuffer, window.location.href).href;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load GLB: ${glbPathOrBuffer}`);
        arrayBuffer = await response.arrayBuffer();
    } else {
        arrayBuffer = glbPathOrBuffer;
    }
    const view = new DataView(arrayBuffer);

    const magic = view.getUint32(0, true);
    if (magic !== 0x46546C67) throw new Error('Not a valid GLB file');

    const jsonLength = view.getUint32(12, true);
    const jsonText = readString(arrayBuffer, 20, jsonLength);
    const json = JSON.parse(jsonText);

    const binOffset = 20 + jsonLength + 8;
    const binLength = view.getUint32(20 + jsonLength, true);
    const binData = arrayBuffer.slice(binOffset, binOffset + binLength);

    const textures = [];
    if (gl && json.images) {
        for (const image of json.images) {
            if (image.bufferView !== undefined) {
                const bv = json.bufferViews[image.bufferView];
                const imgData = binData.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
                textures.push(await decodeImage(gl, image.mimeType || 'image/png', imgData));
            } else {
                textures.push(null);
            }
        }
    }

    const geometry = {};
    const materials = {};

    for (const mesh of (json.meshes || [])) {
        for (let pi = 0; pi < mesh.primitives.length; pi++) {
            const prim = mesh.primitives[pi];
            const name = mesh.primitives.length > 1 ? `${mesh.name}_${pi}` : mesh.name;

            const positions = Array.from(getAccessorData(json, binData, prim.attributes.POSITION));
            const normals = prim.attributes.NORMAL !== undefined
                ? Array.from(getAccessorData(json, binData, prim.attributes.NORMAL))
                : new Array(positions.length).fill(0);
            const texCoords = prim.attributes.TEXCOORD_0 !== undefined
                ? Array.from(getAccessorData(json, binData, prim.attributes.TEXCOORD_0))
                : new Array((positions.length / 3) * 2).fill(0);
            const indices = Array.from(getAccessorData(json, binData, prim.indices));

            let mat = { Ka: [0.5, 0.5, 0.5], Kd: [0.8, 0.8, 0.8], Ks: [0.2, 0.2, 0.2], Ns: 32, d: 1, map_Kd: null };
            let glTexture = null;

            if (prim.material !== undefined && json.materials) {
                const gltfMat = json.materials[prim.material];
                const pbr = gltfMat.pbrMetallicRoughness || {};

                const base = pbr.baseColorFactor || [0.8, 0.8, 0.8, 1.0];
                mat.Kd = base.slice(0, 3);
                mat.Ka = mat.Kd.map(c => c * 0.5);
                mat.d = base[3] ?? 1.0;

                if (pbr.baseColorTexture !== undefined) {
                    const texIndex = json.textures[pbr.baseColorTexture.index].source;
                    glTexture = textures[texIndex] ?? null;
                }

                materials[name] = mat;
            }

            geometry[name] = { positions, normals, texCoords, indices, material: mat, glTexture };
        }
    }

    return { geometry, materials };
}
