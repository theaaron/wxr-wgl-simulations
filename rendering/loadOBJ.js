export async function parseMTL(mtlContent, basePath = '') {
  const materials = {};
  let current = null;

  for (let line of mtlContent.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'newmtl') {
      const name = parts.slice(1).join(' ');
      current = { name, Ka: [0,0,0], Kd: [0.8,0.8,0.8], Ks: [0.2,0.2,0.2], Ns: 32, d: 1, map_Kd: null };
      materials[name] = current;
    } else if (current) {
      if (cmd === 'Ka') {
        current.Ka = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
      } else if (cmd === 'Kd') {
        current.Kd = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
      } else if (cmd === 'Ks') {
        current.Ks = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
      } else if (cmd === 'Ns') {
        current.Ns = parseFloat(parts[1]);
      } else if (cmd === 'd') {
        current.d = parseFloat(parts[1]);
      } else if (cmd === 'map_Kd') {
        const texPath = parts.slice(1).join(' ');
        try {
          current.map_Kd = basePath ? new URL(texPath, basePath).href : texPath;
        } catch (_) {
          current.map_Kd = basePath + texPath;
        }
      }
    }
  }

  return materials;
}

export function parseOBJ(objContent) {
  const positions = [];
  const normals = [];
  const texCoords = [];
  const faces = [];
  let currentGroup = 'default';
  let currentMaterial = null;

  for (let line of objContent.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === 'v') {
      positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'vn') {
      normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
    } else if (cmd === 'vt') {
      texCoords.push([parseFloat(parts[1]), parseFloat(parts[2])]);
    } else if (cmd === 'f') {
      const face = { group: currentGroup, material: currentMaterial, indices: [] };
      for (let i = 1; i < parts.length; i++) {
        const idx = parts[i].split('/');
        face.indices.push({
          v: parseInt(idx[0]) - 1,
          t: idx[1] ? parseInt(idx[1]) - 1 : -1,
          n: idx[2] ? parseInt(idx[2]) - 1 : -1
        });
      }
      faces.push(face);
    } else if (cmd === 'g' || cmd === 'o') {
      currentGroup = parts.slice(1).join(' ') || 'default';
    } else if (cmd === 'usemtl') {
      currentMaterial = parts.slice(1).join(' ');
    }
  }

  return { positions, normals, texCoords, faces };
}

export function buildGeometry(objData, materials) {
  const byMaterial = {};

  for (const face of objData.faces) {
    const matName = face.material || 'default';
    if (!byMaterial[matName]) {
      byMaterial[matName] = {
        positions: [], normals: [], texCoords: [], indices: [],
        material: materials[matName] || { Kd: [0.8,0.8,0.8], Ks: [0.2,0.2,0.2], Ns: 32, d: 1 }
      };
    }

    const geom = byMaterial[matName];

    // fan triangulation for convex polygons
    for (let i = 1; i < face.indices.length - 1; i++) {
      const [i0, i1, i2] = [face.indices[0], face.indices[i], face.indices[i + 1]];
      const baseIndex = geom.positions.length / 3;

      const v0 = objData.positions[i0.v];
      const v1 = objData.positions[i1.v];
      const v2 = objData.positions[i2.v];
      geom.positions.push(...v0, ...v1, ...v2);

      let n0, n1, n2;
      if (i0.n >= 0 && i1.n >= 0 && i2.n >= 0) {
        n0 = objData.normals[i0.n];
        n1 = objData.normals[i1.n];
        n2 = objData.normals[i2.n];
      } else {
        const e1 = [v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]];
        const e2 = [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]];
        const n = [
          e1[1]*e2[2] - e1[2]*e2[1],
          e1[2]*e2[0] - e1[0]*e2[2],
          e1[0]*e2[1] - e1[1]*e2[0]
        ];
        const len = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]);
        n0 = n1 = n2 = [n[0]/len, n[1]/len, n[2]/len];
      }
      geom.normals.push(...n0, ...n1, ...n2);

      const t0 = i0.t >= 0 ? objData.texCoords[i0.t] : [0,0];
      const t1 = i1.t >= 0 ? objData.texCoords[i1.t] : [0,0];
      const t2 = i2.t >= 0 ? objData.texCoords[i2.t] : [0,0];
      geom.texCoords.push(...t0, ...t1, ...t2);

      geom.indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    }
  }

  return byMaterial;
}

export async function loadOBJ(objPath, mtlPath = null) {
  const objUrl = new URL(objPath, window.location.href).href;
  const objResponse = await fetch(objUrl);
  if (!objResponse.ok) throw new Error(`Failed to load OBJ: ${objPath}`);
  const objData = parseOBJ(await objResponse.text());

  let materials = {};
  if (mtlPath) {
    const mtlUrl = new URL(mtlPath, window.location.href).href;
    const mtlResponse = await fetch(mtlUrl);
    if (mtlResponse.ok) {
      const mtlDir = new URL(mtlPath, window.location.href);
      mtlDir.pathname = mtlDir.pathname.substring(0, mtlDir.pathname.lastIndexOf('/') + 1);
      materials = await parseMTL(await mtlResponse.text(), mtlDir.href);
    }
  }

  return { geometry: buildGeometry(objData, materials), materials };
}
