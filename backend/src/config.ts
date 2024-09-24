import convict from "convict";
import { url, ipaddress } from "convict-format-with-validator";
import yaml from "js-yaml";

const EMPTY_S = null as string;
const EMPTY_N = null as number;

convict.addFormat(url);
convict.addFormat(ipaddress);
convict.addParser({extension: ["yml", "yaml"], parse: yaml.load});

export var config = convict({
  web: {
    port: {
      format: "int",
      default: 8000
    }
  },
  bot: {
    token: {format: String, default: EMPTY_S},
    retryDelay: {format: "int", default: 120},
    webAppURL: {format: "url", default: EMPTY_S},
    authEnabled: {format: Boolean, default: true}
  },
  db: {
    host: {format: "url", default: EMPTY_S},
    database: {format: String, default: EMPTY_S},
    user: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    },
    password: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    },
    extras: {
      format: Object,
      default: {connectionLimit: 100}
    }
  },
  spruton: {
    url: {format: "url", default: EMPTY_S},
    username: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    },
    password: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    },
    apiKey: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    }
  },
  tinkoff: {
    terminalKey: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    },
    secretKey: {
      format: String,
      sensitive: true,
      default: EMPTY_S
    }
  }
});
config.loadFile("../config.yml");
config.validate({allowed: "warn"});
