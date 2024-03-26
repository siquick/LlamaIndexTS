import type { ImageNode } from "../Node.js";
import { MetadataMode, splitNodesByType } from "../Node.js";
import { Response } from "../Response.js";
import type { ServiceContext } from "../ServiceContext.js";
import { serviceContextFromDefaults } from "../ServiceContext.js";
import { imageToDataUrl } from "../embeddings/index.js";
import type { MessageContentDetail } from "../llm/types.js";
import { PromptMixin } from "../prompts/Mixin.js";

import { defaultTextQaPrompt } from "./../Prompt.js";

import { Prompt } from "./../prompts/types.js";

import type {
  BaseSynthesizer,
  SynthesizeParamsNonStreaming,
  SynthesizeParamsStreaming,
} from "./types.js";

export class MultiModalResponseSynthesizer
  extends PromptMixin
  implements BaseSynthesizer
{
  serviceContext: ServiceContext;
  metadataMode: MetadataMode;
  textQATemplate: Prompt;

  constructor({
    serviceContext,
    textQATemplate,
    metadataMode,
  }: Partial<MultiModalResponseSynthesizer> = {}) {
    super();

    this.serviceContext = serviceContext ?? serviceContextFromDefaults();
    this.metadataMode = metadataMode ?? MetadataMode.NONE;
    this.textQATemplate = textQATemplate ?? defaultTextQaPrompt;
  }

  protected _getPrompts(): { textQATemplate: Prompt } {
    return {
      textQATemplate: this.textQATemplate,
    };
  }

  protected _updatePrompts(promptsDict: { textQATemplate: Prompt }): void {
    if (promptsDict.textQATemplate) {
      this.textQATemplate = promptsDict.textQATemplate;
    }
  }

  synthesize(
    params: SynthesizeParamsStreaming,
  ): Promise<AsyncIterable<Response>>;
  synthesize(params: SynthesizeParamsNonStreaming): Promise<Response>;
  async synthesize({
    query,
    nodesWithScore,
    parentEvent,
    stream,
  }: SynthesizeParamsStreaming | SynthesizeParamsNonStreaming): Promise<
    AsyncIterable<Response> | Response
  > {
    if (stream) {
      throw new Error("streaming not implemented");
    }
    const nodes = nodesWithScore.map(({ node }) => node);
    const { imageNodes, textNodes } = splitNodesByType(nodes);
    const textChunks = textNodes.map((node) =>
      node.getContent(this.metadataMode),
    );
    // TODO: use builders to generate context
    const context = textChunks.join("\n\n");

    const textQaPrompt = this.textQATemplate.format({ context, query });

    const images = await Promise.all(
      imageNodes.map(async (node: ImageNode) => {
        return {
          type: "image_url",
          image_url: {
            url: await imageToDataUrl(node.image),
          },
        } as MessageContentDetail;
      }),
    );

    // TODO: handle chat message prompt
    if (Array.isArray(textQaPrompt)) {
      throw new Error("textQaPrompt must be a string");
    }

    const prompt: MessageContentDetail[] = [
      { type: "text", text: textQaPrompt },
      ...images,
    ];
    const response = await this.serviceContext.llm.predict({
      prompt,
      parentEvent,
    });
    return new Response(response.text, nodes);
  }
}
