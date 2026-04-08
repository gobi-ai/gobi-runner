import os from "os";

const HOME = process.env.HOME ?? "/root";
const HOST_PROJECTS_DIR = process.env.HOST_PROJECTS_DIR || HOME;
const HOST_HOME_DIR = process.env.HOST_HOME_DIR || HOME;
const HOST_TEMP_DIR = process.env.HOST_TEMP_DIR || "/tmp/agent-runner";

/**
 * Returns true when the runner server itself is running inside a container
 * (Docker-in-Docker mode). Detected by the presence of HOST_PROJECTS_DIR.
 */
export function isContainerized(): boolean {
  return !!HOST_PROJECTS_DIR;
}

/**
 * Translates a container-internal path to the corresponding host-absolute path
 * so that `docker run -v` mounts resolve correctly on the host daemon.
 *
 * When running natively (not containerized), returns the path unchanged.
 */
export function toHostPath(containerPath: string): string {
  if (!isContainerized()) return containerPath;

  // /projects/monorepo -> HOST_PROJECTS_DIR/monorepo
  if (containerPath.startsWith("/projects/")) {
    return `${HOST_PROJECTS_DIR}/${containerPath.slice("/projects/".length)}`;
  }

  // /host-home/.claude -> HOST_HOME_DIR/.claude
  if (containerPath.startsWith("/host-home/")) {
    return `${HOST_HOME_DIR}/${containerPath.slice("/host-home/".length)}`;
  }

  // /tmp/agent-runner/... -> HOST_TEMP_DIR/...
  if (containerPath.startsWith("/tmp/agent-runner/")) {
    return `${HOST_TEMP_DIR}/${containerPath.slice("/tmp/agent-runner/".length)}`;
  }

  return containerPath;
}

/**
 * Returns the home directory path where credentials are mounted.
 * In containerized mode: /host-home (mapped from HOST_HOME_DIR on the host).
 * In native mode: the actual $HOME.
 */
export function getHomeDir(): string {
  return isContainerized() ? "/host-home" : (process.env.HOME ?? "/root");
}

/**
 * Returns the temp directory for trigger files and attachments.
 * In containerized mode: /tmp/agent-runner (shared mount with host).
 * In native mode: the OS temp directory.
 */
export function getTempDir(): string {
  return isContainerized() ? "/tmp/agent-runner" : os.tmpdir();
}
