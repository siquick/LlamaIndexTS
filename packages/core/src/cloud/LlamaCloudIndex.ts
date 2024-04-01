import { PlatformApi } from "@llamaindex/cloud";
import type { Document } from "../Node.js";
import type { BaseRetriever } from "../Retriever.js";
import { RetrieverQueryEngine } from "../engines/query/RetrieverQueryEngine.js";
import type { TransformComponent } from "../ingestion/types.js";
import type { BaseNodePostprocessor } from "../postprocessors/types.js";
import type { BaseSynthesizer } from "../synthesizers/types.js";
import type { BaseQueryEngine } from "../types.js";
import type { CloudRetrieveParams } from "./LlamaCloudRetriever.js";
import { LlamaCloudRetriever } from "./LlamaCloudRetriever.js";
import { getPipelineCreate } from "./config.js";
import type { CloudConstructorParams } from "./types.js";
import { getAppBaseUrl, getClient } from "./utils.js";

import { OpenAIEmbedding } from "../embeddings/OpenAIEmbedding.js";

const defaultTransformations: TransformComponent[] = [new OpenAIEmbedding()];

export class LlamaCloudIndex {
  params: CloudConstructorParams;

  constructor(params: CloudConstructorParams) {
    this.params = params;
  }

  static async fromDocuments(
    params: {
      documents: Document[];
      transformations?: TransformComponent[];
      verbose?: boolean;
    } & CloudConstructorParams,
  ): Promise<LlamaCloudIndex> {
    const appUrl = getAppBaseUrl(params.baseUrl);

    const client = await getClient({ ...params, baseUrl: appUrl });

    const pipelineCreateParams = await getPipelineCreate({
      pipelineName: params.name,
      pipelineType: "MANAGED",
      inputNodes: params.documents,
      transformations: params.transformations ?? defaultTransformations,
    });

    const project = await client.project.upsertProject({
      name: params.name,
    });

    if (!project.id) {
      throw new Error("Project ID should be defined");
    }

    const pipeline = await client.project.upsertPipelineForProject(
      project.id,
      pipelineCreateParams,
    );

    if (!pipeline.id) {
      throw new Error("Pipeline ID must be defined");
    }

    if (params.verbose) {
      console.log(`Created pipeline ${pipeline.id} with name ${params.name}`);
    }

    let isDone = false;

    const execution = await client.pipeline.runManagedPipelineIngestion(
      pipeline.id,
    );

    const ingestionId = execution.id;

    if (!ingestionId) {
      throw new Error("Ingestion ID must be defined");
    }

    while (!isDone) {
      const pipelineStatus = await client.pipeline.getManagedIngestionExecution(
        pipeline.id,
        ingestionId,
      );

      if (pipelineStatus.status === PlatformApi.StatusEnum.Success) {
        isDone = true;

        if (params.verbose) {
          console.info("Ingestion completed");
        }

        break;
      } else if (pipelineStatus.status === PlatformApi.StatusEnum.Error) {
        throw new Error("Ingestion failed");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (params.verbose) {
          process.stdout.write(".");
        }
      }
    }

    if (params.verbose) {
      console.info(
        `Ingestion completed, find your index at ${appUrl}/project/${project.id}/deploy/${pipeline.id}`,
      );
    }

    return new LlamaCloudIndex({ ...params });
  }

  asRetriever(params: CloudRetrieveParams = {}): BaseRetriever {
    return new LlamaCloudRetriever({ ...this.params, ...params });
  }

  asQueryEngine(
    params?: {
      responseSynthesizer?: BaseSynthesizer;
      preFilters?: unknown;
      nodePostprocessors?: BaseNodePostprocessor[];
    } & CloudRetrieveParams,
  ): BaseQueryEngine {
    const retriever = new LlamaCloudRetriever({
      ...this.params,
      ...params,
    });
    return new RetrieverQueryEngine(
      retriever,
      params?.responseSynthesizer,
      params?.preFilters,
      params?.nodePostprocessors,
    );
  }
}
