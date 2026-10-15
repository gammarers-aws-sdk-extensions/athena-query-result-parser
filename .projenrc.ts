import { ProjenTypeScriptProject } from '@gammarers/projen-projects';
const project = new ProjenTypeScriptProject({
  name: 'athena-query-result-parser',
  repositoryUrl: 'https://github.com/gammarers-aws-sdk-extensions/athena-query-result-parser.git',
  description: 'A small TypeScript library that parses Amazon Athena query result `ResultSet` objects (from `@aws-sdk/client-athena`) into header-based row objects. It handles metadata-driven headers, skips the header row when present, and supports custom row transformers.',
  keywords: [
    'athena',
    'query',
    'result',
    'parser',
    'aws',
    'aws-sdk',
  ],
  deps: [
    '@aws-sdk/client-athena@^3.983.0',
  ],
  devDeps: [
    '@gammarers/projen-projects@^0.5.8',
  ],
  releaseToNpm: true,
  npmTrustedPublishing: true,
});
project.synth();
