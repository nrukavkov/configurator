import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as path from "path";
import * as os from "os";
import { getTag } from "./release";
import Mustache from "mustache";

const NameInput: string = "name";
const URLInput: string = "url";
const PathInArchiveInput: string = "pathInArchive";

const FromGitHubReleases: string = "fromGitHubReleases";
const Token: string = "token";
const Repo: string = "repo";
const Version: string = "version";
const IncludePrereleases: string = "includePrereleases";
const URLTemplate: string = "urlTemplate";

export function getConfig(): Configurator {
  return new Configurator(
    core.getInput(NameInput),
    core.getInput(URLInput),
    core.getInput(PathInArchiveInput),

    core.getInput(FromGitHubReleases),
    core.getInput(Token),
    core.getInput(Repo),
    core.getInput(Version),
    core.getInput(IncludePrereleases),
    core.getInput(URLTemplate)
  );
}

export class Configurator {
  name: string;
  url: string;
  pathInArchive: string;

  fromGitHubReleases: boolean;
  token: string;
  repo: string;
  version: string;
  includePrereleases: boolean;
  urlTemplate: string;

  constructor(
    name: string,
    url: string,
    pathInArchive: string,
    fromGitHubRelease: string,
    token: string,
    repo: string,
    version: string,
    includePrereleases: string,
    urlTemplate: string
  ) {
    this.name = name;
    this.url = url;
    this.pathInArchive = pathInArchive;

    this.fromGitHubReleases = fromGitHubRelease == "true";
    this.token = token;
    this.repo = repo;
    this.version = version;
    this.includePrereleases = includePrereleases == "true";
    this.urlTemplate = urlTemplate;
  }

  async configure() {
    this.validate();
    let downloadURL: string;
    if (this.fromGitHubReleases) {
      let tag = await getTag(
        this.token,
        this.repo,
        this.version,
        this.includePrereleases
      );

      downloadURL = Mustache.render(this.urlTemplate, { version: tag });
    } else {
      downloadURL = this.url;
    }

    console.log(`Downloading tool from ${downloadURL}`);
    let downloadPath: string | null = null;
    let archivePath: string | null = null;
    const tempDir = path.join(os.tmpdir(), "tmp", "runner", "temp");
    await io.mkdirP(tempDir);
    downloadPath = await tc.downloadTool(downloadURL);

    switch (getArchiveType(downloadURL)) {
      case ArchiveType.None:
        return this.moveToPath(downloadPath);

      case ArchiveType.TarGz:
        archivePath = await tc.extractTar(downloadPath, tempDir);
        return this.moveToPath(path.join(archivePath, this.pathInArchive));

      case ArchiveType.Zip:
        archivePath = await tc.extractZip(downloadPath, tempDir);
        return this.moveToPath(path.join(archivePath, this.pathInArchive));

      case ArchiveType.SevenZ:
        archivePath = await tc.extract7z(downloadPath, tempDir);
        return this.moveToPath(path.join(archivePath, this.pathInArchive));
    }
  }

  async moveToPath(downloadPath: string) {
    let toolPath = binPath();
    await io.mkdirP(toolPath);
    await io.mv(downloadPath, path.join(toolPath, this.name));

    if (process.platform !== "win32") {
      await exec.exec("chmod", ["+x", path.join(toolPath, this.name)]);
    }

    core.addPath(toolPath);
  }

  validate() {
    if (!this.name) {
      throw new Error(
        `"name" is required. This is used to set the executable name of the tool.`
      );
    }

    if (!this.fromGitHubReleases && !this.url) {
      throw new Error(`"url" is required when downloading a tool directly.`);
    }

    if (!this.fromGitHubReleases && !matchesUrlRegex(this.url)) {
      throw new Error(`"url" supplied as input is not a valid URL.`);
    }

    if (this.fromGitHubReleases && !matchesUrlRegex(this.urlTemplate)) {
      throw new Error(`"urlTemplate" supplied as input is not a valid URL.`);
    }

    if (getArchiveType(this.url) !== ArchiveType.None && !this.pathInArchive) {
      throw new Error(
        `"pathInArchive" is required when "url" points to an archive file`
      );
    }

    if (
      this.fromGitHubReleases &&
      getArchiveType(this.urlTemplate) !== ArchiveType.None &&
      !this.pathInArchive
    ) {
      throw new Error(
        `"pathInArchive" is required when "urlTemplate" points to an archive file.`
      );
    }

    if (
      this.fromGitHubReleases &&
      (!this.token || !this.repo || !this.version || !this.urlTemplate)
    ) {
      throw new Error(
        `if trying to fetch version from GitHub releases, "token", "repo", "version", and "urlTemplate" are required.`
      );
    }
  }
}

export function getArchiveType(downloadURL: string): ArchiveType {
  if (downloadURL.endsWith(ArchiveType.TarGz)) return ArchiveType.TarGz;
  if (downloadURL.endsWith(ArchiveType.Zip)) return ArchiveType.Zip;
  if (downloadURL.endsWith(ArchiveType.SevenZ)) return ArchiveType.SevenZ;

  return ArchiveType.None;
}

export function binPath(): string {
  return path.join(__dirname, ".configurator");
}

export enum ArchiveType {
  None = "",
  TarGz = ".tar.gz",
  Zip = ".zip",
  SevenZ = ".7z",
}

function matchesUrlRegex(input: string): boolean {
  var reg = new RegExp(
    "^(http://www.|https://www.|http://|https://)?[a-z0-9]+([-.]{1}[a-z0-9]+)*.[a-z]{2,5}(:[0-9]{1,5})?(/.*)?$"
  );
  return reg.test(input);
}
