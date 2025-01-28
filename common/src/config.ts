import convict from "convict";
import { url, ipaddress } from "convict-format-with-validator";
import yaml from "js-yaml";

const EMPTY_S = null as string;
const EMPTY_N = null as number;

convict.addFormat(url);
convict.addFormat(
  {
    name: "cleanURL",
    coerce: (v) => {
      let r: string = url.coerce(v);
      if (r.at(-1) == "/") {
        r = r.substring(0, -1);
      }
      return r;
    },
    validate: url.validate
  }
);
convict.addFormat(ipaddress);
convict.addParser({extension: ["yml", "yaml"], parse: yaml.load});

export var config = convict({
  web: {
    apiURL: {format: "cleanURL", default: EMPTY_S},
    port: {
      format: "int",
      default: 8000
    }
  },
  bot: {
    token: {format: String, default: EMPTY_S},
    retryDelay: {format: "int", default: 120},
    webAppURL: {format: "cleanURL", default: EMPTY_S},
    authEnabled: {format: Boolean, default: true},
    adminChat: {format: "int", default: EMPTY_S}
  },
  db: {
    host: {format: "cleanURL", default: EMPTY_S},
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
      default: {connectionLimit: 20}
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
    },
    managerID: {format: "int", default: EMPTY_N}
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
