export async function loadStructure(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load atria data: ${response.status}`);
  }
  const data = await response.json();

  const voxels = [];
  const indices = data.fullTexelIndex;
  const nx = data.nx;
  const ny = data.ny;
  const mx = data.mx;
  const my = data.my;
  
  
  const fullWidth = data.full_width;
  const fullHeight = data.full_height;
  
  let minZ = Infinity, maxZ = -Infinity;
  const zSlicesUsed = new Set();
  
  for (let i = 0; i < indices.length; i += 4) {
    const texX = indices[i];     
    const texY = indices[i + 1]; 
    const slice = indices[i + 2]; 
    const value = indices[i + 3]; 
    
    // normailzing the texture coords
    const pixPosX = texX / fullWidth;
    const pixPosY = texY / fullHeight;
    
    const blockX = Math.floor(pixPosX * mx);
    const blockY = Math.floor(pixPosY * my);
    
    const z = blockX + ((my - 1) - blockY) * mx;
    
    const x = texX % nx;
    const y = texY % ny;
    
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
    zSlicesUsed.add(z);
    
    voxels.push({ x, y, z, value });
  }
  
  console.log(`Grid dimensions: nx=${nx}, ny=${ny}, nz=${mx * my}`);
  console.log(`Texture atlas: ${mx}×${my} blocks of ${nx}×${ny} each`);
  console.log(`Z slices actually used: ${zSlicesUsed.size} slices from ${minZ} to ${maxZ}`);
  console.log(`Using abubu.js fullCoordinator algorithm (Y-inverted block ordering)`);
  
  return {
    dimensions: { nx: data.nx, ny: data.ny, nz: mx * my },
    metadata: {
      mx: data.mx,
      my: data.my,
      threshold: data.threshold,
      fullWidth: data.full_width,
      fullHeight: data.full_height,
      compWidth: data.comp_width,
      compHeight: data.comp_height
    },
    voxels,
    raw: data
  };
}

