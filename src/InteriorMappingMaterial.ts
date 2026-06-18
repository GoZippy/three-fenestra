import {
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  Color,
  Texture,
  Vector2,
  Vector3,
  type IUniform,
  type WebGLRenderer,
} from 'three';

type Shader = {
  uniforms: Record<string, IUniform>;
  vertexShader: string;
  fragmentShader: string;
};

import {
  glslCore,
  vertexCommon,
  vertexBody,
  fragmentCommon,
  fragmentMapReplacement,
  fragmentRoughnessReplacement,
  fragmentMetalnessReplacement,
  fragmentNormalReplacement,
  fragmentOutput,
} from './shader/chunks.js';

/**
 * GPU-side per-window emissive variation derived from `windowId` — lit/unlit
 * windows, warm/cool tones, brightness jitter. Because the decision happens in
 * the shader from `windowId` alone (hash seeds: lit 3.71, tone 9.27,
 * brightness 5.43), a far-LOD impostor shader can hash the same id with the
 * same seeds and reproduce the exact same window, enabling seamless LOD
 * crossfades. When set, this overrides `interiorEmissive`.
 */
export interface EmissiveVariation {
  /** Chance a window is lit, in [0, 1]. Default 0.5. */
  litRatio?: number;
  /** Emissive tint of warm (incandescent) windows. Default (1.7, 1.35, 0.95). */
  warm?: Color;
  /** Emissive tint of cool (fluorescent/TV) windows. Default (0.9, 1.15, 1.5). */
  cool?: Color;
  /** Chance a lit window uses the cool tone. Default 0.22. */
  coolChance?: number;
  /** Minimum brightness multiplier of a lit window. Default 0.3. */
  brightMin?: number;
  /** Random brightness range added on top of brightMin. Default 0.35. */
  brightRange?: number;
  /** Emissive of unlit windows (faintly visible dark room). Default (0.07, 0.08, 0.1). */
  dim?: Color;
}

export interface InteriorMappingMaterialParameters extends MeshStandardMaterialParameters {
  /** Interior atlas — the rooms texture sampled by the ray-march. */
  backAtlas: Texture;
  /** Columns in the back atlas grid. Default 4. */
  backAtlasCols?: number;
  /** Rows in the back atlas grid. Default 4. */
  backAtlasRows?: number;
  /** Apparent room depth in plane-local units. Default 1.0. */
  depth?: number;
  /** Back-wall fill factor in [0.05, 0.999]. Default 0.66. */
  backScale?: number;
  /** Plane size in world units (width, height). Must match the geometry. */
  planeSize: Vector2;
  /**
   * Per-window seed (typically the window center). Controls cell picking.
   * Optional in instanced mode, where `instanceWindowId` replaces it.
   */
  windowId?: Vector3;
  /**
   * Multiplier on the interior contribution before adding to the lit output.
   * Default (1, 1, 1). Tint warm + scale up for a "lights on" night look,
   * e.g. new Color(3.5, 3.0, 2.3).
   */
  interiorEmissive?: Color;
  /**
   * Fraction of interior light that bleeds through the opaque front layer,
   * tinted by the front color. 0 = front layer fully blocks the interior
   * (hard cutoff), 1 = no blocking. Default 0.25.
   */
  frontTransmission?: number;
  /**
   * Raises the effective opacity of the front layer. 1.0 = no change. >1 makes
   * semi-transparent pixels (sheer curtains, antialiased edges) read as more
   * opaque without re-authoring the texture. Useful for "lights on" night mode.
   * Computed as pow(alpha, 1/boost). Default 1.0.
   */
  frontAlphaBoost?: number;

  /** Optional front PBR atlas (RGBA: albedo + alpha). */
  frontAtlas?: Texture;
  /** Columns in the front atlas grid. Default 1. */
  frontAtlasCols?: number;
  /** Rows in the front atlas grid. Default 1. */
  frontAtlasRows?: number;
  /** Optional front normal atlas. Tangent-space normals. */
  frontNormalAtlas?: Texture;
  /** Normal map strength multiplier on .xy. Default 1.0. */
  frontNormalScale?: number;
  /** Optional front roughness atlas (samples .g). */
  frontRoughnessAtlas?: Texture;
  /** Optional front metalness atlas (samples .b). */
  frontMetalnessAtlas?: Texture;

  /**
   * Apparent glass thickness in plane-local units. Parallax-shifts the front
   * overlay sample so it appears to sit on the inside face of the pane rather
   * than glued to the outside surface. 0 disables. Default 0.
   */
  glassThickness?: number;
  /**
   * Magnitude (in cellUV units) of the interior ray-march sample perturbation
   * driven by the glass dirt map. Sells the "looking through real glass" effect.
   * Keep tiny (0.003–0.015). 0 disables. Default 0.
   */
  refractionStrength?: number;
  /**
   * Optional grayscale noise map used as a dirt/specular modulator over the
   * glass area (and as the source of the refraction perturbation). Centered
   * around 0.5; values >0.5 roughen the glass, <0.5 polish it.
   */
  glassDirtMap?: Texture;
  /**
   * How strongly the dirt map modulates roughness on the glass area. Default 0.35.
   */
  glassDirtStrength?: number;
  /**
   * Schlick fresnel sheen added to the glass area at grazing angles. This is
   * the primary "this is a pane of glass" cue. Default 0.0; example uses ~0.5.
   */
  glassFresnelStrength?: number;
  /** Tint of the fresnel sheen. Default cool white (0.85, 0.92, 1.0). */
  glassFresnelColor?: Color;
  /**
   * Additive brightness of dirt visible as smudges on the glass surface.
   * Different from glassDirtStrength (which is roughness modulation). Default 0.0.
   */
  glassSmudgeStrength?: number;

  /**
   * Level-of-detail blend in [0, 1]. 1 = full interior mapping with all glass
   * cues. 0 = flat impostor: the back cell is sampled straight onto the plane
   * with no parallax, and fresnel/refraction/smudge/glass-thickness shut off —
   * pixel-equivalent to a cheap facade shader sampling the same atlas cell.
   * Drive by camera distance to crossfade against a far-LOD facade. Default 1.
   */
  lod?: number;

  /** GPU-side per-window emissive variation (see {@link EmissiveVariation}). */
  emissiveVariation?: EmissiveVariation;

  /**
   * Instanced mode: use with a THREE.InstancedMesh whose geometry carries
   * InstancedBufferAttributes `instanceWindowId` (vec3), `instanceLod`
   * (float) and `instanceFade` (float). They replace the `windowId` / `lod`
   * uniforms per window, and `instanceFade` scales the output alpha (set
   * `transparent: true` to use it for LOD crossfades). One material +
   * one InstancedMesh = thousands of windows in a single draw call.
   * Default false.
   */
  instanced?: boolean;
}

type InteriorUniforms = {
  uBackAtlas: IUniform<Texture | null>;
  uBackAtlasCols: IUniform<number>;
  uBackAtlasRows: IUniform<number>;
  uDepth: IUniform<number>;
  uBackScale: IUniform<number>;
  uPlaneSize: IUniform<Vector2>;
  uWindowId: IUniform<Vector3>;
  uInteriorEmissive: IUniform<Color>;
  uFrontTransmission: IUniform<number>;
  uFrontAlphaBoost: IUniform<number>;
  uFrontAtlas: IUniform<Texture | null>;
  uFrontAtlasCols: IUniform<number>;
  uFrontAtlasRows: IUniform<number>;
  uFrontNormalAtlas: IUniform<Texture | null>;
  uFrontNormalScale: IUniform<number>;
  uFrontRoughnessAtlas: IUniform<Texture | null>;
  uFrontMetalnessAtlas: IUniform<Texture | null>;
  uGlassThickness: IUniform<number>;
  uRefractionStrength: IUniform<number>;
  uGlassDirtMap: IUniform<Texture | null>;
  uGlassDirtStrength: IUniform<number>;
  uGlassFresnelStrength: IUniform<number>;
  uGlassFresnelColor: IUniform<Color>;
  uGlassSmudgeStrength: IUniform<number>;
  uLod: IUniform<number>;
  uVarEnabled: IUniform<number>;
  uVarLitRatio: IUniform<number>;
  uVarWarm: IUniform<Color>;
  uVarCool: IUniform<Color>;
  uVarCoolChance: IUniform<number>;
  uVarBright: IUniform<Vector2>;
  uVarDim: IUniform<Color>;
};

export class InteriorMappingMaterial extends MeshStandardMaterial {
  readonly isInteriorMappingMaterial = true;

  /** Custom uniforms — shared into the patched MeshStandardMaterial shader. */
  readonly interiorUniforms: InteriorUniforms;

  private _instanced = false;

  constructor(params: InteriorMappingMaterialParameters) {
    const { backAtlas, planeSize, windowId, ...std } = params;

    // Strip non-standard fields before passing to MeshStandardMaterial.
    const stdParams: MeshStandardMaterialParameters = { ...std };
    delete (stdParams as Record<string, unknown>).backAtlasCols;
    delete (stdParams as Record<string, unknown>).backAtlasRows;
    delete (stdParams as Record<string, unknown>).depth;
    delete (stdParams as Record<string, unknown>).backScale;
    delete (stdParams as Record<string, unknown>).frontAtlas;
    delete (stdParams as Record<string, unknown>).frontAtlasCols;
    delete (stdParams as Record<string, unknown>).frontAtlasRows;
    delete (stdParams as Record<string, unknown>).frontNormalAtlas;
    delete (stdParams as Record<string, unknown>).frontNormalScale;
    delete (stdParams as Record<string, unknown>).frontRoughnessAtlas;
    delete (stdParams as Record<string, unknown>).frontMetalnessAtlas;
    delete (stdParams as Record<string, unknown>).interiorEmissive;
    delete (stdParams as Record<string, unknown>).frontTransmission;
    delete (stdParams as Record<string, unknown>).frontAlphaBoost;
    delete (stdParams as Record<string, unknown>).glassThickness;
    delete (stdParams as Record<string, unknown>).refractionStrength;
    delete (stdParams as Record<string, unknown>).glassDirtMap;
    delete (stdParams as Record<string, unknown>).glassDirtStrength;
    delete (stdParams as Record<string, unknown>).glassFresnelStrength;
    delete (stdParams as Record<string, unknown>).glassFresnelColor;
    delete (stdParams as Record<string, unknown>).glassSmudgeStrength;
    delete (stdParams as Record<string, unknown>).lod;
    delete (stdParams as Record<string, unknown>).emissiveVariation;
    delete (stdParams as Record<string, unknown>).instanced;

    super(stdParams);

    this._instanced = params.instanced ?? false;
    const ev = params.emissiveVariation;

    this.interiorUniforms = {
      uBackAtlas:           { value: backAtlas },
      uBackAtlasCols:       { value: params.backAtlasCols ?? 4 },
      uBackAtlasRows:       { value: params.backAtlasRows ?? 4 },
      uDepth:               { value: params.depth ?? 1.0 },
      uBackScale:           { value: params.backScale ?? 0.66 },
      uPlaneSize:           { value: planeSize.clone() },
      uWindowId:            { value: (windowId ?? new Vector3()).clone() },
      uInteriorEmissive:    { value: (params.interiorEmissive ?? new Color(1, 1, 1)).clone() },
      uFrontTransmission:   { value: params.frontTransmission ?? 0.25 },
      uFrontAlphaBoost:     { value: params.frontAlphaBoost ?? 1.0 },
      uFrontAtlas:          { value: params.frontAtlas ?? null },
      uFrontAtlasCols:      { value: params.frontAtlasCols ?? 1 },
      uFrontAtlasRows:      { value: params.frontAtlasRows ?? 1 },
      uFrontNormalAtlas:    { value: params.frontNormalAtlas ?? null },
      uFrontNormalScale:    { value: params.frontNormalScale ?? 1.0 },
      uFrontRoughnessAtlas: { value: params.frontRoughnessAtlas ?? null },
      uFrontMetalnessAtlas: { value: params.frontMetalnessAtlas ?? null },
      uGlassThickness:      { value: params.glassThickness ?? 0.0 },
      uRefractionStrength:  { value: params.refractionStrength ?? 0.0 },
      uGlassDirtMap:        { value: params.glassDirtMap ?? null },
      uGlassDirtStrength:   { value: params.glassDirtStrength ?? 0.35 },
      uGlassFresnelStrength:{ value: params.glassFresnelStrength ?? 0.0 },
      uGlassFresnelColor:   { value: (params.glassFresnelColor ?? new Color(0.85, 0.92, 1.0)).clone() },
      uGlassSmudgeStrength: { value: params.glassSmudgeStrength ?? 0.0 },
      uLod:                 { value: params.lod ?? 1.0 },
      uVarEnabled:          { value: ev ? 1.0 : 0.0 },
      uVarLitRatio:         { value: ev?.litRatio ?? 0.5 },
      uVarWarm:             { value: (ev?.warm ?? new Color(1.7, 1.35, 0.95)).clone() },
      uVarCool:             { value: (ev?.cool ?? new Color(0.9, 1.15, 1.5)).clone() },
      uVarCoolChance:       { value: ev?.coolChance ?? 0.22 },
      uVarBright:           { value: new Vector2(ev?.brightMin ?? 0.3, ev?.brightRange ?? 0.35) },
      uVarDim:              { value: (ev?.dim ?? new Color(0.07, 0.08, 0.1)).clone() },
    };

    this.applyDefines();
  }

  /** Set/replace the interior atlas. */
  setBackAtlas(tex: Texture): void {
    this.interiorUniforms.uBackAtlas.value = tex;
  }

  /**
   * Enable/update GPU-side per-window emissive variation, or pass null to
   * disable and fall back to `interiorEmissive`.
   */
  setEmissiveVariation(ev: EmissiveVariation | null): void {
    const u = this.interiorUniforms;
    u.uVarEnabled.value = ev ? 1.0 : 0.0;
    if (!ev) return;
    if (ev.litRatio !== undefined) u.uVarLitRatio.value = ev.litRatio;
    if (ev.warm) u.uVarWarm.value.copy(ev.warm);
    if (ev.cool) u.uVarCool.value.copy(ev.cool);
    if (ev.coolChance !== undefined) u.uVarCoolChance.value = ev.coolChance;
    if (ev.brightMin !== undefined) u.uVarBright.value.x = ev.brightMin;
    if (ev.brightRange !== undefined) u.uVarBright.value.y = ev.brightRange;
    if (ev.dim) u.uVarDim.value.copy(ev.dim);
  }

  /** Set the front albedo atlas (RGBA). Pass null to remove. */
  setFrontAtlas(tex: Texture | null, cols = 1, rows = 1): void {
    this.interiorUniforms.uFrontAtlas.value = tex;
    this.interiorUniforms.uFrontAtlasCols.value = cols;
    this.interiorUniforms.uFrontAtlasRows.value = rows;
    this.applyDefines();
  }

  setFrontNormalAtlas(tex: Texture | null, scale = 1.0): void {
    this.interiorUniforms.uFrontNormalAtlas.value = tex;
    this.interiorUniforms.uFrontNormalScale.value = scale;
    this.applyDefines();
  }

  setFrontRoughnessAtlas(tex: Texture | null): void {
    this.interiorUniforms.uFrontRoughnessAtlas.value = tex;
    this.applyDefines();
  }

  setFrontMetalnessAtlas(tex: Texture | null): void {
    this.interiorUniforms.uFrontMetalnessAtlas.value = tex;
    this.applyDefines();
  }

  setGlassDirtMap(tex: Texture | null): void {
    this.interiorUniforms.uGlassDirtMap.value = tex;
    this.applyDefines();
  }

  /** Mirror the texture presence into shader #defines so onBeforeCompile branches correctly. */
  private applyDefines(): void {
    this.defines = this.defines ?? {};
    const u = this.interiorUniforms;
    const toggle = (key: string, on: boolean) => {
      if (on) this.defines![key] = '';
      else delete this.defines![key];
    };
    toggle('HAS_FRONT_ATLAS',    !!u.uFrontAtlas.value);
    toggle('HAS_FRONT_NORMAL',   !!u.uFrontNormalAtlas.value);
    toggle('HAS_FRONT_ROUGHNESS',!!u.uFrontRoughnessAtlas.value);
    toggle('HAS_FRONT_METALNESS',!!u.uFrontMetalnessAtlas.value);
    toggle('HAS_GLASS_DIRT',     !!u.uGlassDirtMap.value);
    toggle('IM_INSTANCED',       this._instanced);
    this.needsUpdate = true;
  }

  override onBeforeCompile = (shader: Shader, _renderer: WebGLRenderer): void => {
    Object.assign(shader.uniforms, this.interiorUniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexCommon}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${vertexBody}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${glslCore}\n${fragmentCommon}`)
      .replace('#include <map_fragment>', fragmentMapReplacement)
      .replace('#include <roughnessmap_fragment>', fragmentRoughnessReplacement)
      .replace('#include <metalnessmap_fragment>', fragmentMetalnessReplacement)
      .replace('#include <normal_fragment_maps>', fragmentNormalReplacement)
      // Inject BEFORE tonemapping so the linear-space interior gets the same
      // tonemap + color-space conversion as the rest of the lit output.
      .replace(
        '#include <tonemapping_fragment>',
        `${fragmentOutput}\n#include <tonemapping_fragment>`,
      );
  };

  /** Hot-reload-friendly clone of the live runtime knobs. */
  get depth(): number       { return this.interiorUniforms.uDepth.value; }
  set depth(v: number)      { this.interiorUniforms.uDepth.value = v; }
  get backScale(): number   { return this.interiorUniforms.uBackScale.value; }
  set backScale(v: number)  { this.interiorUniforms.uBackScale.value = v; }
  get interiorEmissive(): Color { return this.interiorUniforms.uInteriorEmissive.value; }
  set interiorEmissive(c: Color) { this.interiorUniforms.uInteriorEmissive.value.copy(c); }
  get frontTransmission(): number  { return this.interiorUniforms.uFrontTransmission.value; }
  set frontTransmission(v: number) { this.interiorUniforms.uFrontTransmission.value = v; }
  get frontAlphaBoost(): number    { return this.interiorUniforms.uFrontAlphaBoost.value; }
  set frontAlphaBoost(v: number)   { this.interiorUniforms.uFrontAlphaBoost.value = v; }
  get glassThickness(): number     { return this.interiorUniforms.uGlassThickness.value; }
  set glassThickness(v: number)    { this.interiorUniforms.uGlassThickness.value = v; }
  get refractionStrength(): number { return this.interiorUniforms.uRefractionStrength.value; }
  set refractionStrength(v: number){ this.interiorUniforms.uRefractionStrength.value = v; }
  get glassDirtStrength(): number  { return this.interiorUniforms.uGlassDirtStrength.value; }
  set glassDirtStrength(v: number) { this.interiorUniforms.uGlassDirtStrength.value = v; }
  get glassFresnelStrength(): number  { return this.interiorUniforms.uGlassFresnelStrength.value; }
  set glassFresnelStrength(v: number) { this.interiorUniforms.uGlassFresnelStrength.value = v; }
  get glassFresnelColor(): Color   { return this.interiorUniforms.uGlassFresnelColor.value; }
  set glassFresnelColor(c: Color)  { this.interiorUniforms.uGlassFresnelColor.value.copy(c); }
  get glassSmudgeStrength(): number  { return this.interiorUniforms.uGlassSmudgeStrength.value; }
  set glassSmudgeStrength(v: number) { this.interiorUniforms.uGlassSmudgeStrength.value = v; }
  get lod(): number  { return this.interiorUniforms.uLod.value; }
  set lod(v: number) { this.interiorUniforms.uLod.value = v; }
}
