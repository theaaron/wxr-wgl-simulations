
export const VS_SOURCE = `
    attribute vec4 a_position;
    attribute vec3 a_instancePosition;
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    varying vec3 v_worldPosition;
    void main() {
        vec4 worldPosition = a_position + vec4(a_instancePosition, 0.0);
        vec4 viewPosition = u_viewMatrix * worldPosition;
        gl_Position = u_projectionMatrix * viewPosition;
        v_worldPosition = worldPosition.xyz;
    }
`;

export const FS_SOURCE = `
    precision mediump float;
    varying vec3 v_worldPosition;
    void main() {
        vec3 color = v_worldPosition * 0.1 + 0.5;
        gl_FragColor = vec4(color, 1.0);
    }
`;

export const SIMPLE_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    attribute vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    
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

export const SIMPLE_FS = `
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
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    
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
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

export const PEEL_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        vec3 pos = a_position + a_instancePosition;
        vec4 worldPos = u_modelMatrix * vec4(pos, 1.0);
        gl_Position = u_projectionMatrix * u_viewMatrix * worldPos;
        
        v_position = worldPos.xyz;
        v_normal = a_position;
`;

export const PEEL_FS = `
    precision highp float;
    
    uniform sampler2D u_depthTexture;
    uniform vec2 u_screenSize;
    uniform float u_alpha;
    uniform int u_pass;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    
    void main() {
        vec2 screenCoord = gl_FragCoord.xy / u_screenSize;
        float prevDepth = texture2D(u_depthTexture, screenCoord).r;
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
        
        gl_FragData[0] = vec4(currDepth, 0.0, 0.0, 1.0);
        gl_FragData[1] = vec4(color, u_alpha);
    }
`;

export const BLEND_VS = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const BLEND_FS = `
    precision highp float;
    
    uniform sampler2D u_colorTexture;
    varying vec2 v_texCoord;
    
    void main() {
        vec4 color = texture2D(u_colorTexture, v_texCoord);
        gl_FragColor = color;
    }
`;


export const APPROX_VS = `
    attribute vec3 a_position;
    attribute vec3 a_instancePosition;
    attribute vec3 a_color;
    
    uniform mat4 u_projectionMatrix;
    uniform mat4 u_viewMatrix;
    uniform mat4 u_modelMatrix;
    uniform float u_cubeScale;
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    varying float v_depth;
    
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

export const APPROX_FS = `
    #extension GL_EXT_draw_buffers : require
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
    
    varying vec3 v_position;
    varying vec3 v_normal;
    varying vec3 v_color;
    varying float v_depth;
    
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
        gl_FragData[0] = vec4(premultColor * weight, u_alpha * weight);
        
        // accumulate transmittance
        float transmittance = 1.0 - u_alpha;
        gl_FragData[1] = vec4(transmittance, 0.0, 0.0, 0.0);
    }
`;

export const APPROX_COMPOSITE_VS = `
    attribute vec2 a_position;
    varying vec2 v_texCoord;
    
    void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const APPROX_COMPOSITE_FS = `
    precision highp float;
    
    uniform sampler2D u_accumTexture;
    uniform sampler2D u_revealTexture;
    
    varying vec2 v_texCoord;
    
    void main() {
        vec4 accum = texture2D(u_accumTexture, v_texCoord);
        float sumTransmittance = texture2D(u_revealTexture, v_texCoord).r;
        
        if (accum.a < 0.001) {
            gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
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
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;