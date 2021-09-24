import { promises as fs } from "fs";
import path from "path";
import * as core from "@actions/core";
import fetch, { Headers } from "node-fetch";

interface Config {
  requestToken: string;
  requestUrl: string;
  awsRoleArn: string;
  awsRegion: string;
  gitHubEnvFile: string;
}

function getEnvString(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var not found`);
  }
  return value;
}

async function fetchWebIdentityToken(config: Config): Promise<string> {
  const headers = new Headers({ Authorization: `bearer ${config.requestToken}` });
  const response = await fetch(`${config.requestUrl}&audience=sigstore`, {
    headers,
  });
  const responseJson = (await response.json()) as Record<string, unknown>;
  return responseJson.value as string;
}

async function run(): Promise<void> {
  try {
    const config: Config = {
      requestToken: getEnvString(`ACTIONS_ID_TOKEN_REQUEST_TOKEN`),
      requestUrl: getEnvString("ACTIONS_ID_TOKEN_REQUEST_URL"),
      awsRoleArn: core.getInput("awsRoleToAssume"),
      awsRegion: core.getInput("awsRegion"),
      gitHubEnvFile: getEnvString("GITHUB_ENV"),
    };

    // fetching the token
    const token = await fetchWebIdentityToken(config);

    // save the token to disk
    const tempDir = await fs.mkdtemp("aws-creds");
    const tokenFile = path.join(tempDir, "aws.creds.json");
    await fs.writeFile(tokenFile, token, { encoding: "utf-8" });

    const env = {
      AWS_WEB_IDENTITY_TOKEN_FILE: tokenFile,
      AWS_ROLE_ARN: config.awsRoleArn,
      AWS_DEFAULT_REGION: config.awsRegion,
      AWS_REGION: config.awsRegion,
    };
    const envString = Object.entries(env)
      .map(([key, value]) => `${key}=${value}\n`)
      .join("");

    await fs.appendFile(config.gitHubEnvFile, envString);
  } catch (error) {
    const errorMessage = (err: unknown) => {
      if (typeof err === "string") {
        return err;
      }
      if (err instanceof Error) {
        return err.message;
      }
      return "Internal Error";
    };

    core.setFailed(errorMessage(error));
  }
}

void run();
