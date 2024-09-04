import { express } from "express";
import { cors } from "cors";
import http from "http";
import bodyParser from "body-parser";

import { config } from "./config";

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
const server = http.createServer(app);

{
  const port = config.get("web.port");
  server.listen(
    port,
    () => { console.log(`Server is running on port ${port}`); }
  );
}
