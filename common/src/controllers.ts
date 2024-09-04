import axios from "axios";
import type { Config } from "convict";

import { ENTITIES_RAW, FIELDS_RAW, VALUES, ENTITIES, FIELDS, SprutonItem } from "./structures";

interface SprutonConfigSchema {
  spruton: {
    username: string,
    password: string,
    apiKey: string,
    url: string
  }
};

export class Spruton<ConfigSchemaT extends SprutonConfigSchema> {
  protected readonly config: Config<SprutonConfigSchema>;

  constructor(config: Config<ConfigSchemaT>) {
    // some force casting magic cause of type matching problem
    this.config = config as unknown as Config<SprutonConfigSchema>;
  }

  public async fetchNews(
    newsIDs: number[]
  ): Promise<{[key: number]: SprutonItem}> {
    if (!newsIDs.length) { return {}; }
    const fetchResp = await axios.post(
      `${this.config.get("spruton.url")}/api/rest.php`,
      {
        username: this.config.get("spruton.username"),
        password: this.config.get("spruton.password"),
        key: this.config.get("spruton.apiKey"),
        action: "select",
        entity_id: ENTITIES_RAW.news,
        items: {
          id: newsIDs.join(",")
        }
      },
      {headers: {"Content-Type": "multipart/form-data"}}
    );
    return Object.fromEntries(
      fetchResp.data["data"].map(
        x => [x.id, x]
      )
    );
  }

  public imageURL(
    item: SprutonItem,
    field: number
  ): string {
    return `${this.config.get("spruton.url")}/${item[field]}`;
  }
}
