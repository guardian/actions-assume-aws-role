import { createReadStream, promises as fs } from "fs";
import path from "path";
import * as core from "@actions/core";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fromWebToken } from "@aws-sdk/credential-providers";
import type { Credentials, Provider } from "@aws-sdk/types";
import fetch, { Headers } from "node-fetch";

/*
GH Org secrets for:
- artifact bucket // in param store
- build bucket // in param store
- AWS role to assume // cloudformed https://github.com/guardian/deploy-tools-platform/blob/main/cloudformation/riffraff/riffraff.template.yaml

- Validate inputs
- Generate `build.json`
- Assume the role
- Upload all the files to artifact bucket
- Upload `build.json` to build bucket
 */

interface Config {
  requestToken: string;
  requestUrl: string;
  awsRoleArn: string;
  awsRegion: string;
  artifactBucket: string;
  buildBucket: string;
}

// Schema defined here https://github.com/guardian/riff-raff/blob/main/riff-raff/public/docs/reference/build.json.md
interface BuildJson {
  projectName: string;
  buildNumber: string;
  startTime: string;
  vcsURL: string;
  branch: string;
  revision: string;
}

async function doesRiffRaffFileExist(filepath: string): Promise<boolean> {
  return (await fs.stat(filepath)).isFile();
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
  return JSON.stringify(responseJson.value);
}

async function getCredentialProvider(config: Config): Promise<Provider<Credentials>> {
  const webIdentityToken = await fetchWebIdentityToken(config);

  return fromWebToken({
    roleArn: config.awsRoleArn,
    webIdentityToken,
  });
}

async function getFiles(dir: string): Promise<string[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : [res];
    })
  );

  return Array.prototype.concat(...files) as string[];
}

function getBuildJson(): BuildJson {
  const [, repoName] = getEnvString("GITHUB_REPOSITORY").split("/");
  const maybeProjectName = core.getInput("projectName");
  const projectName = maybeProjectName !== "" ? maybeProjectName : repoName;

  return {
    projectName,
    buildNumber: getEnvString("GITHUB_RUN_NUMBER"),
    branch: getEnvString("GITHUB_REF"),
    revision: getEnvString("GITHUB_SHA"),
    startTime: new Date().toISOString(),
    vcsURL: `${getEnvString("GITHUB_SERVER_URL")}/${repoName}`,
  };
}

async function run(): Promise<void> {
  try {
    const config: Config = {
      requestToken: getEnvString(`ACTIONS_ID_TOKEN_REQUEST_TOKEN`),
      requestUrl: getEnvString("ACTIONS_ID_TOKEN_REQUEST_URL"),
      awsRoleArn: core.getInput("awsRoleToAssume"),
      awsRegion: core.getInput("awsRegion"),
      artifactBucket: core.getInput("artifactBucket"),
      buildBucket: core.getInput("buildBucket"),
    };

    core.debug("*** START config ***");
    core.debug(JSON.stringify(config));
    core.debug("*** END config ***");

    const buildJson = getBuildJson();
    core.debug("*** START build.json ***");
    core.debug(JSON.stringify(buildJson, null, 2));
    core.debug("*** END build.json ***");

    const artifactDirectory: string = core.getInput("artifactDirectory");
    const riffRaffFile = path.join(artifactDirectory, "riff-raff.yaml");

    if (!(await doesRiffRaffFileExist(riffRaffFile))) {
      core.setFailed(`Cannot find the file ${riffRaffFile}`);
      return;
    }

    const credentialProvider = await getCredentialProvider(config);

    const s3Client = new S3Client({
      region: config.awsRegion,
      credentials: credentialProvider,
    });

    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.buildBucket,
        Key: path.join(buildJson.projectName, buildJson.buildNumber, "build.json"),
        Body: JSON.stringify(buildJson),
      })
    );

    const artifactFiles: string[] = await getFiles(artifactDirectory);

    await Promise.all(
      artifactFiles.map(async (filePath) => {
        return await s3Client.send(
          new PutObjectCommand({
            Bucket: config.artifactBucket,
            Key: path.join(buildJson.projectName, buildJson.buildNumber, filePath.replace(artifactDirectory, "")),
            Body: createReadStream(filePath),
          })
        );
      })
    );
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
