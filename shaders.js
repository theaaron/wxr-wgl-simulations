
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
    in vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    out vec3 v_position;
    out vec3 v_normal;
    out vec3 v_color;
    
    void main() {
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
        v_color = a_color;
    }
`;

export const SIMPLE_FS = `#version 300 es
    precision highp float;
    
    uniform int u_useVertexColor;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    // light properties
    uniform vec3 u_lightDirection;
    uniform vec3 u_lightColor;
    uniform vec3 u_lightAmbient;
    uniform vec3 u_lightSpecular;
    
    // material properties
    uniform vec3 u_materialAmbient;
    uniform vec3 u_materialSpecular;
    uniform float u_shininess;
    
    in vec3 v_position;
    in vec3 v_normal;
    in vec3 v_color;
    
    out vec4 fragColor;
    
    void main() {
        vec3 N = normalize(v_normal);
        vec3 E = normalize(-v_position);
        vec3 L = normalize(u_lightDirection);
        vec3 R = reflect(L, N);
        float lambertTerm = dot(N, -L);
        
        vec3 materialColor = (u_useVertexColor == 1) ? v_color : abs(normalize(v_position));
        
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
    in vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    out vec3 v_position;
    out vec3 v_normal;
    out vec3 v_color;
    out float v_depth;
    
    void main() {
        vec3 scaledCubeVertex = a_position * u_cubeScale;
        vec3 pos = scaledCubeVertex + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        vec4 clipPos = u_projectionMatrix * u_viewMatrix * worldPos;
        gl_Position = clipPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
        v_color = a_color;
        v_depth = clipPos.z / clipPos.w * 0.5 + 0.5;
    }
`;

export const APPROX_FS = `#version 300 es
    precision highp float;
    
    uniform float u_alpha;
    uniform int u_useVertexColor;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    // light properties
    uniform vec3 u_lightDirection;
    uniform vec3 u_lightColor;
    uniform vec3 u_lightAmbient;
    uniform vec3 u_lightSpecular;
    
    // material properties
    uniform vec3 u_materialAmbient;
    uniform vec3 u_materialSpecular;
    uniform float u_shininess;
    
    in vec3 v_position;
    in vec3 v_normal;
    in vec3 v_color;
    in float v_depth;
    
    layout(location = 0) out vec4 accumColor;
    layout(location = 1) out vec4 revealage;
    
    void main() {
        vec3 N = normalize(v_normal);
        vec3 E = normalize(-v_position);
        vec3 L = normalize(u_lightDirection);
        vec3 R = reflect(L, N);
        float lambertTerm = dot(N, -L);
        
        vec3 materialColor = (u_useVertexColor == 1) ? v_color : abs(normalize(v_position));
        
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
        
        // depth-based weight for OIT
        float z = v_depth;
        float weight = u_alpha * max(0.01, 3000.0 * pow(1.0 - z, 3.0));
        
        // pre-multiply alpha for light absorption through layers
        vec3 premultColor = finalColor * u_alpha;
        
        // accumulate weighted color
        accumColor = vec4(premultColor * weight, u_alpha * weight);
        
        // accumulate transmittance
        float transmittance = 1.0 - u_alpha;
        revealage = vec4(transmittance, 0.0, 0.0, 0.0);
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
        float sumTransmittance = texture(u_revealTexture, v_texCoord).r;
        
        if (accum.a < 0.001) {
            fragColor = vec4(1.0, 1.0, 1.0, 1.0);
            return;
        }
        
        // recover average color
        vec3 avgColor = accum.rgb / max(accum.a, 0.00001);
        
        // unused for now, might use later for better transparency
        float avgTransmittance = sumTransmittance / max(accum.a, 0.00001);
        
        // calculate opacity - more layers = more opaque
        float absorption = 1.0 - exp(-accum.a * 2.5);
        float opacity = clamp(absorption, 0.0, 1.0);
        
        // darken based on number of layers
        float darkening = exp(-accum.a * 0.2);
        vec3 darkenedColor = avgColor * darkening;
        
        // at high alpha, skip darkening to preserve color
        if (accum.a > 10.0) {
            darkenedColor = avgColor;
        }
        
        vec3 finalColor = mix(vec3(1.0), darkenedColor, opacity);
        
        fragColor = vec4(finalColor, 1.0);
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
    in vec3 a_position;
    in vec3 a_instancePosition;
    in float a_instanceID;
    
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