export {
  InteriorMappingMaterial,
  type InteriorMappingMaterialParameters,
  type EmissiveVariation,
} from './InteriorMappingMaterial.js';
// Parameterized GLSL core (imHash / imWindowEmissive / imAtlasUV /
// imRoomBoxUV) for embedding interior mapping into arbitrary materials —
// prepend to a fragment shader via onBeforeCompile.
export { glslCore } from './shader/chunks.js';
