
export const VS_SOURCE = `#version 300 es
    in vec4 a_position;
    in vec3 a_instancePosition;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    out vec3 v_worldPosition;
    void main() {
        vec4 worldPosition = a_position + vec4(a_instancePosition, 0.0);
        vec4 viewPosition = u_viewMatrix * worldPosition;
        gl_Position = u_projectionMatrix * viewPosition;
        v_worldPosition = worldPosition.xyz;
    }
`;

export const FS_SOURCE = `#version 300 es
    precision mediump float;
    in vec3 v_worldPosition;
    out vec4 fragColor;
    void main() {
        vec3 color = v_worldPosition * 0.1 + 0.5;
        fragColor = vec4(color, 1.0);
    }
`;

export const SIMPLE_VS = `#version 300 es
    in vec3 a_position;
    in vec3 a_instancePosition;
    in vec3 a_instanceNormal;
    in vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform mat4 u_normalMatrix;
    uniform float u_cubeScale;

    uniform highp sampler2D u_voltageTexture;
    uniform int u_simTexWidth;
    uniform bool u_useSimTexture;
    
    out vec3 v_position;
    out vec3 v_normal;
    out vec3 v_color;
    out float v_shade;

    vec3 voltageColormap(float v) {
        const vec3 cmap[11] = vec3[11](
            vec3(0.85, 0.85, 0.85),
            vec3(0.7,  0.7,  0.9),
            vec3(0.4,  0.5,  1.0),
            vec3(0.0,  0.7,  1.0),
            vec3(0.0,  1.0,  0.8),
            vec3(0.2,  1.0,  0.4),
            vec3(0.6,  1.0,  0.0),
            vec3(1.0,  1.0,  0.0),
            vec3(1.0,  0.6,  0.0),
            vec3(1.0,  0.3,  0.0),
            vec3(1.0,  0.0,  0.0)
        );
        v = clamp(v, 0.0, 1.0);
        float idx = v * 10.0;
        int i0 = int(floor(idx));
        int i1 = min(i0 + 1, 10);
        float t = idx - float(i0);
        return mix(cmap[i0], cmap[i1], t);
    }
    
    void main() {
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        vec4 viewPos = u_viewMatrix * worldPos;
        gl_Position = u_projectionMatrix * viewPos;
        
        v_position = viewPos.xyz;
        v_normal = mat3(u_normalMatrix) * a_instanceNormal;

        bool isSurface = length(a_instanceNormal) > 0.1;
        float voltage = 0.0;

        if (u_useSimTexture && u_simTexWidth > 0) {
            ivec2 texCoord = ivec2(gl_InstanceID % u_simTexWidth, gl_InstanceID / u_simTexWidth);
            voltage = texelFetch(u_voltageTexture, texCoord, 0).r;
            v_color = isSurface ? voltageColormap(voltage) : voltageColormap(voltage);
        } else {
            v_color = a_color;
        }

        // hide interior voxels at rest; show surface voxels always
        v_shade = (isSurface || voltage >= 0.1) ? 1.0 : 0.0;
    }
`;

export const SIMPLE_FS = `#version 300 es
    precision highp float;
    
    uniform int u_useVertexColor;
    uniform mat4 u_viewMatrix;
    
    // light properties (in view space)
    uniform vec3 u_lightDirection;
    uniform vec3 u_lightColor;
    uniform vec3 u_lightAmbient;
    uniform vec3 u_lightSpecular;
    
    // material properties
    uniform vec3 u_materialAmbient;
    uniform vec3 u_materialSpecular;
    uniform float u_shininess;
    
    in vec3 v_position;  // in view space
    in vec3 v_normal;    // transformed by normalMatrix
    in vec3 v_color;
    in float v_shade;
    
    out vec4 fragColor;
    
    void main() {
        // don't discard on v_shade — let depth test handle z-ordering.
        // interior voxels are naturally occluded by surface voxels in front.

        vec3 materialColor = (u_useVertexColor == 1) ? v_color : vec3(0.9, 0.9, 0.9);

        float nLen = length(v_normal);
        if (nLen < 0.001) {
            // interior voxel with zero normal — render flat gray so depth test still occludes it
            fragColor = vec4(materialColor * 0.5, 1.0);
            return;
        }

        vec3 N = normalize(v_normal);
        vec3 E = normalize(-v_position);
        
        vec3 L = normalize(mat3(u_viewMatrix) * u_lightDirection);
        vec3 R = reflect(L, N);
        float lambertTerm = dot(N, -L);
        
        vec3 Ia = u_lightAmbient * u_materialAmbient * materialColor;
        
        vec3 Id = vec3(0.0);
        vec3 Is = vec3(0.0);
        if (lambertTerm > 0.0) {
            Id = u_lightColor * materialColor * lambertTerm;
            float specular = pow(max(dot(R, E), 0.0), u_shininess);
            Is = u_lightSpecular * u_materialSpecular * specular;
        }
        
        vec3 finalColor = Ia + Id + Is;
        fragColor = vec4(finalColor, 1.0);
    }
`;

export const PEEL_VS = `#version 300 es
    in vec3 a_position;
    in vec3 a_instancePosition;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    out vec3 v_position;
    out vec3 v_normal;
    
    void main() {
        vec3 pos = a_position + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
    }
`;

export const PEEL_FS = `#version 300 es
    precision highp float;
    
    uniform sampler2D u_depthTexture;
    uniform vec2 u_screenSize;
    uniform float u_alpha;
    uniform int u_pass;
    
    in vec3 v_position;
    in vec3 v_normal;
    
    layout(location = 0) out vec4 outDepth;
    layout(location = 1) out vec4 outColor;
    
    void main() {
        vec2 screenCoord = gl_FragCoord.xy / u_screenSize;
        float prevDepth = texture(u_depthTexture, screenCoord).r;
        float currDepth = gl_FragCoord.z;
        
        // depth peeling - discard if at or in front of previous layer
        if (u_pass > 0 && currDepth <= prevDepth + 0.0001) {
            discard;
        }
        
        // simple lighting
        vec3 lightDir = normalize(vec3(0.5, 0.5, -1.0));
        vec3 normal = normalize(v_normal);
        float diff = max(dot(normal, lightDir), 0.0) * 0.6 + 0.4;
        
        vec3 color = abs(normalize(v_position)) * diff;
        
        outDepth = vec4(currDepth, 0.0, 0.0, 1.0);
        outColor = vec4(color, u_alpha);
    }
`;

export const BLEND_VS = `#version 300 es
    in vec2 a_position;
    out vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const BLEND_FS = `#version 300 es
    precision highp float;
    
    uniform sampler2D u_colorTexture;
    in vec2 v_texCoord;
    out vec4 fragColor;
    
    void main() {
        vec4 color = texture(u_colorTexture, v_texCoord);
        fragColor = color;
    }
`;


export const APPROX_VS = `#version 300 es
    in vec3 a_position;
    in vec3 a_instancePosition;
    in vec3 a_instanceNormal;
    in vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform mat4 u_normalMatrix;
    uniform float u_cubeScale;

    uniform highp sampler2D u_voltageTexture;
    uniform int u_simTexWidth;
    uniform bool u_useSimTexture;
    
    out vec3 v_position;
    out vec3 v_normal;
    out vec3 v_color;
    out float v_depth;
    out float v_shade;

    vec3 voltageColormap(float v) {
        const vec3 cmap[11] = vec3[11](
            vec3(0.85, 0.85, 0.85),
            vec3(0.7,  0.7,  0.9),
            vec3(0.4,  0.5,  1.0),
            vec3(0.0,  0.7,  1.0),
            vec3(0.0,  1.0,  0.8),
            vec3(0.2,  1.0,  0.4),
            vec3(0.6,  1.0,  0.0),
            vec3(1.0,  1.0,  0.0),
            vec3(1.0,  0.6,  0.0),
            vec3(1.0,  0.3,  0.0),
            vec3(1.0,  0.0,  0.0)
        );
        v = clamp(v, 0.0, 1.0);
        float idx = v * 10.0;
        int i0 = int(floor(idx));
        int i1 = min(i0 + 1, 10);
        float t = idx - float(i0);
        return mix(cmap[i0], cmap[i1], t);
    }
    
    void main() {
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        vec4 viewPos = u_viewMatrix * worldPos;
        vec4 clipPos = u_projectionMatrix * viewPos;
        gl_Position = clipPos;
        
        v_position = viewPos.xyz;
        v_normal = mat3(u_normalMatrix) * a_instanceNormal;
        v_depth = clipPos.z / clipPos.w * 0.5 + 0.5;

        bool isSurface = length(a_instanceNormal) > 0.1;
        float voltage = 0.0;

        if (u_useSimTexture && u_simTexWidth > 0) {
            ivec2 texCoord = ivec2(gl_InstanceID % u_simTexWidth, gl_InstanceID / u_simTexWidth);
            voltage = texelFetch(u_voltageTexture, texCoord, 0).r;
            v_color = voltageColormap(voltage);
        } else {
            v_color = a_color;
        }

        // hide interior voxels at rest; show surface voxels always
        v_shade = (isSurface || voltage >= 0.1) ? 1.0 : 0.0;
    }
`;

export const APPROX_FS = `#version 300 es
    precision highp float;
    
    uniform float u_alpha;
    uniform int u_useVertexColor;
    uniform mat4 u_viewMatrix;
    
    // light properties (in view space)
    uniform vec3 u_lightDirection;
    uniform vec3 u_lightColor;
    uniform vec3 u_lightAmbient;
    uniform vec3 u_lightSpecular;
    
    // material properties
    uniform vec3 u_materialAmbient;
    uniform vec3 u_materialSpecular;
    uniform float u_shininess;
    
    in vec3 v_position;  // in view space
    in vec3 v_normal;    // transformed by normalMatrix
    in vec3 v_color;
    in float v_depth;
    in float v_shade;
    
    layout(location = 0) out vec4 accumColor;
    layout(location = 1) out vec4 revealage;
    
    void main() {
        if (v_shade < 0.5) discard;

        vec3 N = normalize(v_normal);
        vec3 E = normalize(-v_position);  // eye vector in view space
        
        // transform light direction to view space so it stays fixed relative to viewer
        vec3 L = normalize(mat3(u_viewMatrix) * u_lightDirection);
        vec3 R = reflect(L, N);
        float lambertTerm = dot(N, -L);
        
        // use vertex color if set, otherwise neutral gray like Abubu
        vec3 materialColor = (u_useVertexColor == 1) ? v_color : vec3(0.9, 0.9, 0.9);
        
        // ambient
        vec3 Ia = u_lightAmbient * u_materialAmbient * materialColor;
        
        // diffuse + specular
        vec3 Id = vec3(0.0);
        vec3 Is = vec3(0.0);
        if (lambertTerm > 0.0) {
            Id = u_lightColor * materialColor * lambertTerm;
            float specular = pow(max(dot(R, E), 0.0), u_shininess);
            Is = u_lightSpecular * u_materialSpecular * specular;
        }
        
        vec3 finalColor = Ia + Id + Is;
        
        // depth-based weight for OIT (McGuire/Bavoil)
        float z = v_depth;
        float weight = u_alpha * max(0.01, 3000.0 * pow(1.0 - z, 3.0));
        
        // accumulate weighted color (additive blend: ONE, ONE)
        accumColor = vec4(finalColor * u_alpha * weight, u_alpha * weight);
        
        // reveal: store -log(1 - alpha) so additive sum = -log(product of transmittances)
        // i.e. exp(-sum) recovers the correct total transmittance without multiplicative blending
        float alpha_clamped = clamp(u_alpha, 0.0, 0.9999);
        revealage = vec4(-log(1.0 - alpha_clamped), 0.0, 0.0, 0.0);
    }
`;

export const APPROX_COMPOSITE_VS = `#version 300 es
    in vec2 a_position;
    out vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const APPROX_COMPOSITE_FS = `#version 300 es
    precision highp float;
    
    uniform sampler2D u_accumTexture;
    uniform sampler2D u_revealTexture;
    
    in vec2 v_texCoord;
    out vec4 fragColor;
    
    void main() {
        vec4 accum = texture(u_accumTexture, v_texCoord);
        float negLogTransmittance = texture(u_revealTexture, v_texCoord).r;
        
        // skip pixels where no OIT fragments landed — preserve the lab background
        if (accum.a < 0.001 && negLogTransmittance < 0.001) {
            discard;
            return;
        }
        
        // weighted average color across all layers
        vec3 avgColor = accum.rgb / max(accum.a, 1e-5);
        
        // force fully opaque — structure is surface-only so it should be solid
        fragColor = vec4(avgColor, 1.0);
    }
`;

// ============================================================================
// PICKING SHADERS - Encode instance ID as color for mouse picking
// ============================================================================

export const PICKER_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    uniform sampler2D u_instanceDataTexture;
    uniform float u_instanceTextureWidth;
    
    varying float v_instanceID;
    
    void main() {
        // Get instance ID (WebGL1 ANGLE_instanced_arrays doesn't have gl_InstanceID)
        // We'll pass it via a separate attribute or compute it
        // For now, we'll use a workaround - pass via texture lookup
        
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        // Instance ID will be passed from vertex attribute
        v_instanceID = 0.0; // Will be set by attribute
    }
`;

export const PICKER_VS_SIMPLE = `#version 300 es
    layout(location = 0) in vec3 a_position;
    layout(location = 1) in vec3 a_instancePosition;
    layout(location = 2) in float a_instanceID;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    out float v_instanceID;
    
    void main() {
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_instanceID = a_instanceID;
    }
`;

export const PICKER_FS = `#version 300 es
    precision highp float;
    
    in float v_instanceID;
    out vec4 fragColor;
    
    void main() {
        // Encode instance ID into RGB channels
        // For IDs 0-226575, we only need R and G channels (B stays 0)
        float id = v_instanceID;
        
        // Simple encoding: R = high byte, G = mid byte, B = low byte
        // ID = R*65536 + G*256 + B
        float r = floor(id / 65536.0);
        float remaining = id - (r * 65536.0);
        float g = floor(remaining / 256.0);
        float b = mod(remaining, 256.0);
        
        // Normalize to 0-1 range and output
        fragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
        
        // DEBUG: Uncomment to visualize low IDs as grayscale
        // float gray = id / 1000.0;
        // fragColor = vec4(gray, gray, gray, 1.0);
    }
`;

// ============================================================================
// OBJ MODEL SHADERS - For rendering lab environment
// ============================================================================

export const OBJ_VS = `#version 300 es
    layout(location = 0) in vec3 a_position;
    layout(location = 1) in vec3 a_normal;
    layout(location = 2) in vec2 a_texCoord;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform mat4 u_normalMatrix;
    
    out vec3 v_position;
    out vec3 v_normal;
    out vec2 v_texCoord;
    
    void main() {
        vec4 worldPos = u_modelMatrix * vec4(a_position, 1.0);
        vec4 viewPos = u_viewMatrix * worldPos;
        gl_Position = u_projectionMatrix * viewPos;
        
        v_position = viewPos.xyz;
        v_normal = normalize(mat3(u_normalMatrix) * a_normal);
        v_texCoord = a_texCoord;
    }
`;

export const OBJ_FS = `#version 300 es
    precision highp float;
    
    uniform mat4 u_viewMatrix;
    
    // Material properties
    uniform vec3 u_materialAmbient;
    uniform vec3 u_materialDiffuse;
    uniform vec3 u_materialSpecular;
    uniform float u_materialShininess;
    uniform float u_materialOpacity;
    uniform sampler2D u_diffuseTexture;
    uniform bool u_hasDiffuseTexture;
    
    // Light properties
    uniform vec3 u_lightDirection;
    uniform vec3 u_lightColor;
    uniform vec3 u_lightAmbient;
    uniform vec3 u_lightSpecular;
    
    in vec3 v_position;
    in vec3 v_normal;
    in vec2 v_texCoord;
    
    out vec4 fragColor;
    
    void main() {
        vec3 N = normalize(v_normal);
        vec3 E = normalize(-v_position);
        
        // Transform light direction to view space
        vec3 L = normalize(mat3(u_viewMatrix) * u_lightDirection);
        vec3 R = reflect(L, N);
        float lambertTerm = dot(N, -L);
        
        // Get base color from texture or material
        vec3 baseColor = u_hasDiffuseTexture 
            ? texture(u_diffuseTexture, v_texCoord).rgb 
            : u_materialDiffuse;
        
        // Ambient
        vec3 Ia = u_lightAmbient * u_materialAmbient * baseColor;
        
        // Diffuse + Specular
        vec3 Id = vec3(0.0);
        vec3 Is = vec3(0.0);
        if (lambertTerm > 0.0) {
            Id = u_lightColor * baseColor * lambertTerm;
            float specular = pow(max(dot(R, E), 0.0), u_materialShininess);
            Is = u_lightSpecular * u_materialSpecular * specular;
        }
        
        vec3 finalColor = Ia + Id + Is;
        fragColor = vec4(finalColor, u_materialOpacity);
    }
`;

// ============================================================================
// DEPTH-PEEL VOXEL SHADERS
// Attribute-free: position/normal fetched from textures via gl_VertexID.
// Draw with gl.drawArrays(TRIANGLES, 0, 36 * numVoxels) — no VBOs needed.
// ============================================================================

export const DEPTH_PEEL_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform int         u_noVoxels;
uniform float       u_voxelSize;
uniform float       u_alpha;

uniform sampler2D   u_posTex;
uniform sampler2D   u_normalTex;

uniform sampler2D   u_voltageTex;
uniform int         u_compWidth;
uniform bool        u_useSimTex;

uniform mat4        u_projectionMatrix;
uniform mat4        u_viewMatrix;
uniform mat4        u_modelMatrix;
uniform mat4        u_normalMatrix;

uniform float       u_cutX;
uniform float       u_cutY;
uniform float       u_cutZ;

uniform vec4        u_lightColor;
uniform float       u_lightAmbientTerm;
uniform float       u_lightSpecularTerm;
uniform vec3        u_lightDirection;
uniform vec4        u_materialColor;
uniform float       u_materialAmbientTerm;
uniform float       u_materialSpecularTerm;
uniform float       u_shininess;

out vec4  v_color;
out float v_shade;
out float v_cut;

vec3 jetColor(float t) {
    t = clamp(t, 0.0, 1.0);
    float r = clamp(1.5 - abs(4.0 * t - 3.0), 0.0, 1.0);
    float g = clamp(1.5 - abs(4.0 * t - 2.0), 0.0, 1.0);
    float b = clamp(1.5 - abs(4.0 * t - 1.0), 0.0, 1.0);
    return vec3(r, g, b);
}

void main() {
    vec3 cv[36];
    cv[0] =vec3(0,0,1);cv[1] =vec3(1,0,1);cv[2] =vec3(0,1,1);
    cv[3] =vec3(0,1,1);cv[4] =vec3(1,0,1);cv[5] =vec3(1,1,1);
    cv[6] =vec3(1,1,1);cv[7] =vec3(1,0,1);cv[8] =vec3(1,1,0);
    cv[9] =vec3(1,1,0);cv[10]=vec3(1,0,1);cv[11]=vec3(1,0,0);
    cv[12]=vec3(1,0,0);cv[13]=vec3(1,0,1);cv[14]=vec3(0,0,0);
    cv[15]=vec3(0,0,0);cv[16]=vec3(1,0,1);cv[17]=vec3(0,0,1);
    cv[18]=vec3(0,0,1);cv[19]=vec3(0,1,1);cv[20]=vec3(0,0,0);
    cv[21]=vec3(0,0,0);cv[22]=vec3(0,1,1);cv[23]=vec3(0,1,0);
    cv[24]=vec3(0,1,0);cv[25]=vec3(0,1,1);cv[26]=vec3(1,1,1);
    cv[27]=vec3(1,1,1);cv[28]=vec3(1,1,0);cv[29]=vec3(0,1,0);
    cv[30]=vec3(0,1,0);cv[31]=vec3(1,1,0);cv[32]=vec3(0,0,0);
    cv[33]=vec3(0,0,0);cv[34]=vec3(1,1,0);cv[35]=vec3(1,0,0);

    int vertId  = gl_VertexID % 36;
    int voxelId = gl_VertexID / 36;

    ivec2 texSize = textureSize(u_posTex, 0);
    ivec2 tc      = ivec2(voxelId % texSize.x, voxelId / texSize.x);
    vec4  pos4    = texelFetch(u_posTex, tc, 0);
    v_shade       = (pos4.a > 0.5) ? 1.0 : 0.0;
    v_cut         = (pos4.x > u_cutX || pos4.y > u_cutY || pos4.z > u_cutZ) ? 1.0 : 0.0;

    vec3 pos = (pos4.xyz - 0.5) * 2.0;
    pos += u_voxelSize * 0.005 * 2.0 * (cv[vertId] - 0.5);

    vec3 surfNormal = texelFetch(u_normalTex, tc, 0).xyz;
    float nLen = length(surfNormal);
    if (nLen < 0.01) v_shade = 0.0;

    vec3 N = (nLen > 0.01) ? normalize(mat3(u_normalMatrix) * surfNormal) : vec3(0,1,0);
    vec3 E = normalize(-(u_viewMatrix * u_modelMatrix * vec4(pos, 1.0)).xyz);
    vec3 L = normalize(u_lightDirection);
    vec3 R = reflect(L, N);
    float lambert = dot(N, -L);

    vec4 mColor = u_materialColor;
    if (u_useSimTex && u_compWidth > 0) {
        ivec2 simTC = ivec2(voxelId % u_compWidth, voxelId / u_compWidth);
        float voltage = texelFetch(u_voltageTex, simTC, 0).r;
        if (voltage > 0.05) mColor = vec4(jetColor(voltage), 1.0);
    }

    vec4 Ia = vec4(vec3(u_lightAmbientTerm * u_materialAmbientTerm), 1.0);
    vec4 Id = vec4(0.0);
    vec4 Is = vec4(0.0);
    if (lambert > 0.0) {
        Id = u_lightColor * mColor * lambert;
        float spec = pow(max(dot(R, E), 0.0), u_shininess);
        Is = vec4(vec3(u_lightSpecularTerm * u_materialSpecularTerm * spec), 1.0);
    }

    v_color = vec4(vec3(Ia + Id + Is), u_alpha);
    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(pos, 1.0);
}
`;

export const DEPTH_PEEL_FS = `#version 300 es
precision highp float;
in vec4  v_color;
in float v_shade;
in float v_cut;
out vec4 fragColor;
void main() {
    if (v_shade < 0.5 || v_cut > 0.5) discard;
    fragColor = v_color;
}
`;

// ============================================================================
// SURFACE VISUALIZER SHADERS
// ============================================================================

export const SURF_VS = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 a_indices;
layout(location = 1) in vec2 a_compIdx;

uniform sampler2D   u_posTex;
uniform sampler2D   u_normalTex;
uniform sampler2D   u_voltageTex;
uniform sampler2D   u_ablationTex;
uniform bool        u_useSimTex;

uniform mat4  u_projectionMatrix;
uniform mat4  u_viewMatrix;
uniform mat4  u_modelMatrix;
uniform mat4  u_normalMatrix;

uniform float u_cutX;
uniform float u_cutY;
uniform float u_cutZ;

out vec3  v_N;
out vec3  v_E;
out float v_voltage;
out float v_useVoltage;
out float v_cut;
out float v_ablated;

void main() {
    ivec2 voxIdx = ivec2(a_compIdx);
    vec3  pos    = texelFetch(u_posTex, voxIdx, 0).xyz;

    v_cut = (pos.x > u_cutX || pos.y > u_cutY || pos.z > u_cutZ) ? 1.0 : 0.0;

    vec3 worldPos = (pos - 0.5) * 2.0;

    vec3  rawN = texelFetch(u_normalTex, voxIdx, 0).xyz;
    float nLen = length(rawN);
    v_N = (nLen > 0.01) ? normalize(mat3(u_normalMatrix) * rawN) : vec3(0.0, 1.0, 0.0);
    v_E = normalize(-(u_viewMatrix * u_modelMatrix * vec4(worldPos, 1.0)).xyz);

    v_ablated = texelFetch(u_ablationTex, voxIdx, 0).r;

    if (u_useSimTex) {
        v_voltage    = texelFetch(u_voltageTex, voxIdx, 0).r;
        v_useVoltage = 1.0;
    } else {
        v_voltage    = 0.0;
        v_useVoltage = 0.0;
    }

    gl_Position = u_projectionMatrix * u_viewMatrix * u_modelMatrix * vec4(worldPos, 1.0);
}
`;

export const SURF_FS = `#version 300 es
precision highp float;

in vec3  v_N;
in vec3  v_E;
in float v_voltage;
in float v_useVoltage;
in float v_cut;
in float v_ablated;

uniform vec3  u_lightDirection;
uniform vec4  u_lightColor;
uniform float u_lightAmbientTerm;
uniform float u_lightSpecularTerm;
uniform vec4  u_materialColor;
uniform float u_materialAmbientTerm;
uniform float u_materialSpecularTerm;
uniform float u_shininess;

out vec4 fragColor;

vec3 jetColor(float t) {
    t = clamp(t, 0.0, 1.0);
    float r = clamp(1.5 - abs(4.0 * t - 3.0), 0.0, 1.0);
    float g = clamp(1.5 - abs(4.0 * t - 2.0), 0.0, 1.0);
    float b = clamp(1.5 - abs(4.0 * t - 1.0), 0.0, 1.0);
    return vec3(r, g, b);
}

void main() {
    if (v_cut > 0.5) discard;

    // ablated tissue bypasses voltage coloring, just giving it a dark gray color. 
    if (v_ablated > 0.5) {
        fragColor = vec4(0.25, 0.2, 0.2, 1.0);
        return;
    }

    vec4 mColor = (v_useVoltage > 0.5 && v_voltage > 0.05)
        ? vec4(jetColor(v_voltage), 1.0)
        : u_materialColor;

    vec3  L       = normalize(u_lightDirection);
    vec3  R       = reflect(L, v_N);
    float lambert = dot(v_N, -L);

    vec4 Ia = vec4(vec3(u_lightAmbientTerm * u_materialAmbientTerm), 1.0);
    vec4 Id = vec4(0.0);
    vec4 Is = vec4(0.0);
    if (lambert > 0.0) {
        Id = u_lightColor * mColor * lambert;
        float spec = pow(max(dot(R, v_E), 0.0), u_shininess);
        Is = vec4(vec3(u_lightSpecularTerm * u_materialSpecularTerm * spec), 1.0);
    }

    fragColor = vec4(vec3(Ia + Id + Is), 1.0);
}
`;