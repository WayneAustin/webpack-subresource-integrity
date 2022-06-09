/**
 * Copyright (c) 2015-present, Waysact Pty Ltd
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { AssetInfo, Chunk, Compiler, Compilation, sources } from "webpack";
import { relative, join } from "path";
import { readFileSync } from "fs";
import * as assert from "typed-assert";
import {
  HtmlTagObject,
  SubresourceIntegrityPluginResolvedOptions,
  StronglyConnectedComponent,
} from "./types";
import { Reporter } from "./reporter";
import {
  computeIntegrity,
  makePlaceholder,
  findChunks,
  normalizePath,
  getTagSrc,
  notNil,
  getChunkToManifestMap,
  sriHashVariableReference,
} from "./util";

type AssetType = "js" | "css";

type TemplateFiles = { [key in AssetType]: string[] };

interface HWPAssets {
  publicPath: string;
  js: string[];
  css: string[];
  favicon?: string | undefined;
  manifest?: string | undefined;
}

interface WSIHWPAssets extends HWPAssets {
  jsIntegrity: string[];
  cssIntegrity: string[];
}

type KeysOfType<T, TProp> = {
  [P in keyof T]: T[P] extends TProp ? P : never;
}[keyof T];

type WSIHWPAssetsIntegrityKey = KeysOfType<WSIHWPAssets, string[]>;

const assetTypeIntegrityKeys: [AssetType, WSIHWPAssetsIntegrityKey][] = [
  ["js", "jsIntegrity"],
  ["css", "cssIntegrity"],
];

export class Plugin {
  /**
   * @internal
   */
  private readonly compilation: Compilation;

  /**
   * @internal
   */
  private readonly options: SubresourceIntegrityPluginResolvedOptions;

  /**
   * @internal
   */
  private readonly reporter: Reporter;

  /**
   * @internal
   */
  private assetIntegrity: Map<string, string> = new Map();

  /**
   * @internal
   */
  private inverseAssetIntegrity: Map<string, string> = new Map();

  /**
   * @internal
   */
  private hwpPublicPath: string | null = null;

  /**
   * @internal
   */
  private sortedSccChunks: StronglyConnectedComponent<Chunk>[] = [];

  /**
   * @internal
   */
  private chunkManifest: Map<Chunk, Set<Chunk>> = new Map<Chunk, Set<Chunk>>();

  /**
   * @internal
   */
  private hashByChunkId = new Map<string | number, string>();

  public constructor(
    compilation: Compilation,
    options: SubresourceIntegrityPluginResolvedOptions,
    reporter: Reporter
  ) {
    this.compilation = compilation;
    this.options = options;
    this.reporter = reporter;
  }

  /**
   * @internal
   */
  private warnIfHotUpdate(source: string | Buffer): void {
    if (source.indexOf("webpackHotUpdate") >= 0) {
      this.reporter.warnOnce(
        "webpack-subresource-integrity may interfere with hot reloading. " +
          "Consider disabling this plugin in development mode."
      );
    }
  }

  /**
   * @internal
   */
  private updateAssetIntegrity(assetKey: string, integrity: string) {
    if (!this.assetIntegrity.has(assetKey)) {
      this.assetIntegrity.set(assetKey, integrity);
      this.inverseAssetIntegrity.set(integrity, assetKey);
    }
  }

  /**
   * @internal
   */
  addMissingIntegrityHashes = (
    assets: Record<string, sources.Source>
  ): void => {
    Object.keys(assets).forEach((assetKey) => {
      const asset = assets[assetKey];
      let source;
      try {
        source = asset.source();
      } catch (_) {
        return;
      }
      this.updateAssetIntegrity(
        assetKey,
        computeIntegrity(this.options.hashFuncNames, source)
      );
    });
  };

  /**
   * @internal
   */
  private replaceAsset = (
    compiler: Compiler,
    assets: Record<string, sources.Source>,
    hashByChunkId: Map<string | number, string>,
    chunkFile: string
  ): sources.Source => {
    const oldSource = assets[chunkFile].source();
    const hashFuncNames = this.options.hashFuncNames;
    const newAsset = new compiler.webpack.sources.ReplaceSource(
      assets[chunkFile],
      chunkFile
    );

    Array.from(hashByChunkId.entries()).forEach((idAndHash) => {
      const magicMarker = makePlaceholder(hashFuncNames, idAndHash[0]);
      const magicMarkerPos = oldSource.indexOf(magicMarker);
      if (magicMarkerPos >= 0) {
        newAsset.replace(
          magicMarkerPos,
          magicMarkerPos + magicMarker.length - 1,
          idAndHash[1],
          chunkFile
        );
      }
    });

    assets[chunkFile] = newAsset;

    return newAsset;
  };

  private warnAboutLongTermCaching = (assetInfo: AssetInfo) => {
    if (
      (assetInfo.fullhash ||
        assetInfo.chunkhash ||
        assetInfo.modulehash ||
        assetInfo.contenthash) &&
      !(
        assetInfo.contenthash &&
        this.compilation.compiler.options.optimization.realContentHash
      )
    ) {
      this.reporter.warnOnce(
        "Using [hash], [fullhash], [modulehash], or [chunkhash] is dangerous \
with SRI. The same is true for [contenthash] when realContentHash is disabled. \
Use [contenthash] and ensure realContentHash is enabled. See the README for \
more information."
      );
    }
  };

  /**
   * @internal
   */
  private processChunk = (
    chunk: Chunk,
    assets: Record<string, sources.Source>
  ): void => {
    Array.from(findChunks(chunk))
      .reverse()
      .forEach((chunk) => this.processChunkAssets(chunk, assets));
  };

  private processChunkAssets = (
    childChunk: Chunk,
    assets: Record<string, sources.Source>
  ) => {
    const files: string[] = Array.from(childChunk.files);

    if (files.length <= 0) files.push(`${childChunk.id}.js` as string);
    files.forEach((sourcePath) => {
      if (assets[sourcePath]) {
        this.warnIfHotUpdate(assets[sourcePath].source());
        const newAsset = this.replaceAsset(
          this.compilation.compiler,
          assets,
          this.hashByChunkId,
          sourcePath
        );
        const integrity = computeIntegrity(
          this.options.hashFuncNames,
          newAsset.source()
        );

        if (childChunk.id !== null) {
          this.hashByChunkId.set(childChunk.id, integrity);
        }
        this.updateAssetIntegrity(sourcePath, integrity);
        this.compilation.updateAsset(
          sourcePath,
          (x) => x,
          (assetInfo) => {
            if (!assetInfo) {
              return undefined;
            }

            this.warnAboutLongTermCaching(assetInfo);

            return {
              ...assetInfo,
              contenthash: Array.isArray(assetInfo.contenthash)
                ? [...new Set([...assetInfo.contenthash, integrity])]
                : assetInfo.contenthash
                ? [assetInfo.contenthash, integrity]
                : integrity,
            };
          }
        );
      } else {
        this.reporter.warnOnce(
          `No asset found for source path '${sourcePath}', options are ${Object.keys(
            assets
          ).join(", ")}`
        );
      }
    });
  };

  /**
   * @internal
   */
  addAttribute = (elName: string, source: string): string => {
    if (!this.compilation.outputOptions.crossOriginLoading) {
      this.reporter.errorOnce(
        "webpack option output.crossOriginLoading not set, code splitting will not work!"
      );
    }

    return this.compilation.compiler.webpack.Template.asString([
      source,
      elName + `.integrity = ${sriHashVariableReference}[chunkId];`,
      elName +
        ".crossOrigin = " +
        JSON.stringify(this.compilation.outputOptions.crossOriginLoading) +
        ";",
    ]);
  };

  /**
   * @internal
   */
  processAssets = (assets: Record<string, sources.Source>): void => {
    if (this.options.hashLoading === "lazy") {
      for (const scc of this.sortedSccChunks) {
        for (const chunk of scc.nodes) {
          this.processChunkAssets(chunk, assets);
        }
      }
    } else {
      Array.from(this.compilation.chunks)
        //.filter((chunk) => chunk.hasRuntime())
        .forEach((chunk) => {
          this.processChunk(chunk, assets);
        });
    }

    this.addMissingIntegrityHashes(assets);
  };

  /**
   * @internal
   */
  private hwpAssetPath = (src: string): string => {
    assert.isNotNull(this.hwpPublicPath);
    return relative(this.hwpPublicPath, src);
  };

  /**
   * @internal
   */
  private getIntegrityChecksumForAsset = (
    assets: Record<string, sources.Source>,
    src: string
  ): string | undefined => {
    if (this.assetIntegrity.has(src)) {
      return this.assetIntegrity.get(src);
    }

    const normalizedSrc = normalizePath(src);
    const normalizedKey = Object.keys(assets).find(
      (assetKey) => normalizePath(assetKey) === normalizedSrc
    );
    if (normalizedKey) {
      return this.assetIntegrity.get(normalizedKey);
    }
    return undefined;
  };

  /**
   * @internal
   */
  processTag = (tag: HtmlTagObject): void => {
    if (
      tag.attributes &&
      Object.prototype.hasOwnProperty.call(tag.attributes, "integrity")
    ) {
      return;
    }

    const tagSrc = getTagSrc(tag);

    if (!tagSrc) {
      return;
    }

    const src = this.hwpAssetPath(tagSrc);

    tag.attributes.integrity =
      this.getIntegrityChecksumForAsset(this.compilation.assets, src) ||
      computeIntegrity(
        this.options.hashFuncNames,
        readFileSync(join(this.compilation.compiler.outputPath, src))
      );
    tag.attributes.crossorigin =
      this.compilation.compiler.options.output.crossOriginLoading ||
      "anonymous";
  };

  /**
   * @internal
   */
  beforeRuntimeRequirements = (): void => {
    if (this.options.hashLoading === "lazy") {
      const [sortedSccChunks, chunkManifest] = getChunkToManifestMap(
        this.compilation.chunks
      );
      this.sortedSccChunks = sortedSccChunks;
      this.chunkManifest = chunkManifest;
    }
    this.hashByChunkId.clear();
  };

  getChildChunksToAddToChunkManifest(chunk: Chunk): Set<Chunk> {
    return this.chunkManifest.get(chunk) ?? new Set<Chunk>();
  }

  handleHwpPluginArgs = ({ assets }: { assets: HWPAssets }): void => {
    this.hwpPublicPath = assets.publicPath;

    assetTypeIntegrityKeys.forEach(
      ([a, b]: [AssetType, WSIHWPAssetsIntegrityKey]) => {
        if (b) {
          (assets as WSIHWPAssets)[b] = (assets as TemplateFiles)[a]
            .map((filePath: string) =>
              this.getIntegrityChecksumForAsset(
                this.compilation.assets,
                this.hwpAssetPath(filePath)
              )
            )
            .filter(notNil);
        }
      }
    );
  };

  updateHash = (input: Buffer[], oldHash: string): string | undefined => {
    const assetKey = this.inverseAssetIntegrity.get(oldHash);
    if (assetKey && input.length === 1) {
      const newIntegrity = computeIntegrity(
        this.options.hashFuncNames,
        input[0]
      );
      this.inverseAssetIntegrity.delete(oldHash);
      this.assetIntegrity.delete(assetKey);
      this.updateAssetIntegrity(assetKey, newIntegrity);

      return newIntegrity;
    }
    return undefined;
  };

  handleHwpBodyTags = ({
    headTags,
    bodyTags,
  }: {
    headTags: HtmlTagObject[];
    bodyTags: HtmlTagObject[];
  }): void => {
    this.addMissingIntegrityHashes(this.compilation.assets);

    headTags
      .concat(bodyTags)
      .forEach((tag: HtmlTagObject) => this.processTag(tag));
  };
}
