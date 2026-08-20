#!/usr/bin/env node

const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_JOB_TIMEOUT_SECONDS = 300;
const RESOURCE_NAMES = ["profile", "network", "watchlist", "watched"];

const [baseUrlArgument, usernameArgument, resourceArgument = "profile"] =
  process.argv.slice(2);

if (baseUrlArgument === "--help" || baseUrlArgument === "-h") {
  printUsage();
  process.exit(0);
}

const baseUrlValue = baseUrlArgument ?? process.env.DEPLOYED_API_URL;
const usernameValue = usernameArgument ?? process.env.LETTERBOXD_USERNAME;
const resourceValue = resourceArgument ?? process.env.API_SMOKE_RESOURCE ?? "profile";
const jobTimeoutSeconds = parsePositiveInteger(
  process.env.API_SMOKE_TIMEOUT_SECONDS,
  DEFAULT_JOB_TIMEOUT_SECONDS
);

if (!baseUrlValue || !usernameValue) {
  printUsage();
  process.exit(1);
}

const baseUrl = normalizeBaseUrl(baseUrlValue);
const username = usernameValue.trim().replace(/^@/, "");
const resources =
  resourceValue === "all" ? RESOURCE_NAMES : resourceValue.split(",");

if (!username) {
  fail("The Letterboxd username cannot be empty.");
}

for (const resource of resources) {
  if (!RESOURCE_NAMES.includes(resource)) {
    fail(
      `Unknown resource "${resource}". Use ${RESOURCE_NAMES.join(", ")}, or all.`
    );
  }
}

try {
  for (const resource of resources) {
    const endpoint = resourceEndpoint(baseUrl, username, resource);
    const body = await fetchResource(endpoint, jobTimeoutSeconds);
    console.log(`\nResult for ${resource}:`);
    console.log(JSON.stringify(body, null, 2));
  }
} catch (error) {
  console.error(`\nSmoke test failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}

async function fetchResource(endpoint, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1_000;

  while (Date.now() < deadline) {
    const { response, body } = await requestJson(endpoint);

    if (response.status === 200) {
      console.log(`✓ ${response.status} ${response.statusText}`);
      return body;
    }

    if (response.status !== 202) {
      throw new Error(formatHttpError(response, body));
    }

    const jobs = body?.meta?.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw new Error("The API returned 202 without any job information.");
    }

    console.log(
      `• ${response.status} ${response.statusText}; waiting for ${jobs.length} job${
        jobs.length === 1 ? "" : "s"
      }`
    );

    const uniqueJobs = [
      ...new Map(jobs.map((job) => [job.id, job])).values(),
    ];
    await Promise.all(
      uniqueJobs.map((job) => pollJob(baseUrl, job, deadline))
    );

    console.log("• Jobs completed; requesting the resource again");
  }

  throw new Error(`Timed out after ${timeoutSeconds}s waiting for the resource.`);
}

async function pollJob(baseUrl, initialJob, deadline) {
  const statusUrl = new URL(initialJob.statusUrl, baseUrl);
  let lastStatus;

  while (Date.now() < deadline) {
    const { response, body } = await requestJson(statusUrl);
    if (response.status !== 200) {
      throw new Error(formatHttpError(response, body));
    }

    const job = body?.data;
    if (!job || typeof job.status !== "string") {
      throw new Error(`Invalid job response from ${statusUrl}`);
    }

    if (job.status !== lastStatus) {
      console.log(`  ${job.id}: ${job.status} (attempts: ${job.attempts ?? 0})`);
      lastStatus = job.status;
    }

    if (job.status === "succeeded") return;
    if (job.status === "failed") {
      const detail = job.error
        ? `${job.error.code}: ${job.error.message}`
        : "unknown job error";
      throw new Error(`Job ${job.id} failed: ${detail}`);
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for job ${initialJob.id}.`);
}

async function requestJson(url) {
  console.log(`→ GET ${url}`);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();

  if (!text) return { response, body: null };

  try {
    return { response, body: JSON.parse(text) };
  } catch {
    throw new Error(
      `${response.status} ${response.statusText} returned non-JSON: ${text.slice(0, 300)}`
    );
  }
}

function resourceEndpoint(baseUrl, username, resource) {
  const encodedUsername = encodeURIComponent(username);
  const suffix = resource === "profile" ? "" : `/${resource}`;
  const url = new URL(`/api/v1/users/${encodedUsername}${suffix}`, baseUrl);

  if (resource === "watchlist" || resource === "watched") {
    url.searchParams.set("page", "1");
    url.searchParams.set("pageSize", "5");
  }

  return url;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`Invalid deployment URL: ${value}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail("The deployment URL must use http or https.");
  }

  return url;
}

function formatHttpError(response, body) {
  const apiMessage = body?.error?.message;
  return `${response.status} ${response.statusText}${
    apiMessage ? `: ${apiMessage}` : ""
  }`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage:
  npm run api:smoke -- <deployment-url> <letterboxd-username> [resource]

Resources:
  profile (default), network, watchlist, watched, all

Examples:
  npm run api:smoke -- https://your-app.vercel.app alice
  npm run api:smoke -- https://your-app.vercel.app alice network
  npm run api:smoke -- https://your-app.vercel.app alice profile,watchlist

Optional environment variables:
  DEPLOYED_API_URL
  LETTERBOXD_USERNAME
  API_SMOKE_RESOURCE
  API_SMOKE_TIMEOUT_SECONDS (default: ${DEFAULT_JOB_TIMEOUT_SECONDS})`);
}
