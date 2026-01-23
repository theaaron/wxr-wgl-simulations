// colormap utilities for visualizing voltage

// Colormap matching original Abubu - gray at rest, red when excited
const rainbowHotSpring = [
    [0.85, 0.85, 0.85],   // 0.0 - light gray (resting)
    [0.7, 0.7, 0.9],      // 0.1 - gray-blue
    [0.4, 0.5, 1.0],      // 0.2 - blue
    [0.0, 0.7, 1.0],      // 0.3 - cyan-blue
    [0.0, 1.0, 0.8],      // 0.4 - cyan
    [0.2, 1.0, 0.4],      // 0.5 - green
    [0.6, 1.0, 0.0],      // 0.6 - yellow-green
    [1.0, 1.0, 0.0],      // 0.7 - yellow
    [1.0, 0.6, 0.0],      // 0.8 - orange
    [1.0, 0.3, 0.0],      // 0.9 - red-orange
    [1.0, 0.0, 0.0],      // 1.0 - red (depolarized)
];

// simple blue-to-red colormap
const blueToRed = [
    [0.0, 0.0, 1.0],      // 0.0 - blue (resting)
    [0.5, 0.0, 0.5],      // 0.5 - purple
    [1.0, 0.0, 0.0],      // 1.0 - red (depolarized)
];

// jet colormap
const jet = [
    [0.0, 0.0, 0.5],
    [0.0, 0.0, 1.0],
    [0.0, 0.5, 1.0],
    [0.0, 1.0, 1.0],
    [0.5, 1.0, 0.5],
    [1.0, 1.0, 0.0],
    [1.0, 0.5, 0.0],
    [1.0, 0.0, 0.0],
    [0.5, 0.0, 0.0],
];

const colormaps = {
    rainbowHotSpring,
    blueToRed,
    jet,
};

let currentColormap = rainbowHotSpring;

export function setColormap(name) {
    if (colormaps[name]) {
        currentColormap = colormaps[name];
    }
}

export function getColormapNames() {
    return Object.keys(colormaps);
}

// map a value [0, 1] to RGB color using current colormap
export function mapValueToColor(value) {
    value = Math.max(0, Math.min(1, value));
    
    const n = currentColormap.length - 1;
    const idx = value * n;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, n);
    const t = idx - i0;
    
    const c0 = currentColormap[i0];
    const c1 = currentColormap[i1];
    
    return [
        c0[0] + t * (c1[0] - c0[0]),
        c0[1] + t * (c1[1] - c0[1]),
        c0[2] + t * (c1[2] - c0[2]),
    ];
}

// apply colormap to voltage data, output RGB colors
export function voltageToColors(voltageData, numVoxels, voxelToTexelMap) {
    const colors = new Float32Array(numVoxels * 3);
    
    for (let i = 0; i < numVoxels; i++) {
        let voltage = 0;
        
        if (voxelToTexelMap && voxelToTexelMap[i] !== undefined) {
            const texelIdx = voxelToTexelMap[i];
            if (texelIdx >= 0 && voltageData) {
                voltage = voltageData[texelIdx * 4];  // U is in R channel
            }
        }
        
        const [r, g, b] = mapValueToColor(voltage);
        colors[i * 3 + 0] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
    }
    
    return colors;
}

// build mapping from voxel index to compressed texel index
export function buildVoxelToTexelMap(structure) {
    const voxels = structure.voxels;
    const meta = structure.metadata;
    const mx = meta.mx;
    const my = meta.my;
    const fullWidth = meta.fullWidth;
    const compWidth = meta.compWidth;
    
    const map = new Int32Array(voxels.length);
    
    // build reverse lookup: full texel position -> compressed index
    const fullToComp = new Map();
    const indices = structure.raw.fullTexelIndex;
    
    for (let i = 0; i < indices.length; i += 4) {
        const texX = indices[i];
        const texY = indices[i + 1];
        const valid = indices[i + 3];
        
        if (valid === 1) {
            const fullIdx = texY * fullWidth + texX;
            const compIdx = i / 4;
            fullToComp.set(fullIdx, compIdx);
        }
    }
    
    // for each voxel, find its compressed texel index
    for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];
        
        // convert 3D coords back to texture coords
        const nx = structure.dimensions.nx;
        const ny = structure.dimensions.ny;
        
        // reverse of the load algorithm
        const z = v.z;
        const blockX = z % mx;
        const blockY = (my - 1) - Math.floor(z / mx);
        
        const texX = v.x + blockX * nx;
        const texY = v.y + blockY * ny;
        
        const fullIdx = texY * fullWidth + texX;
        
        if (fullToComp.has(fullIdx)) {
            map[i] = fullToComp.get(fullIdx);
        } else {
            map[i] = -1;  // not found
        }
    }
    
    return map;
}
