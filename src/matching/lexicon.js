/**
 * Skill vocabulary, surface-form aliases and seniority ladder.
 *
 * ZERO-IMPORT RULE: only `./normalize.js` may be imported here, and nothing
 * from outside `src/matching/`. See `src/matching/index.js`.
 */

import { tokenize } from './normalize.js';

/** Weight a category gets when it is missing from {@link CATEGORY_WEIGHTS}. */
const DEFAULT_CATEGORY_WEIGHT = 1.0;

/**
 * Per-category weights. Category, not per-term, so tuning stays a one-line
 * change and nobody has to audit 400 individual numbers.
 *
 * `ml` sits slightly above baseline because ML terms are strong differentiators
 * — few candidates claim them falsely and a JD that lists them means it.
 * `soft` sits far below baseline (0.4) on purpose: every JD lists communication
 * and teamwork, so at baseline weight a resume full of soft-skill filler would
 * out-score one with the actual stack. Soft skills should nudge a score, never
 * decide it.
 *
 * @type {Record<string, number>}
 */
const CATEGORY_WEIGHTS = {
  language: 1.0,
  frontend: 1.0,
  backend: 1.0,
  data: 1.0,
  ml: 1.1,
  cloud: 1.0,
  mobile: 1.0,
  design: 0.9,
  pm: 0.8,
  practice: 0.9,
  soft: 0.4,
};

/**
 * The vocabulary, grouped so it is readable and reviewable. Each string is both
 * the surface form and the canonical term; anything that needs a different
 * canonical goes in {@link ALIASES} instead.
 *
 * All entries must already be in `normalizeText` form: lowercase, single
 * spaces, no accents.
 */
const RAW_LEXICON = {
  language: [
    'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'c', 'go',
    'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab', 'perl',
    'elixir', 'erlang', 'haskell', 'clojure', 'f#', 'dart', 'lua',
    'objective-c', 'groovy', 'julia', 'fortran', 'cobol', 'assembly',
    'visual basic', 'vba', 'bash', 'shell scripting', 'powershell', 'zsh',
    'sql', 'plsql', 't-sql', 'html', 'css', 'sass', 'scss', 'less', 'xml',
    'json', 'yaml', 'solidity', 'ocaml', 'racket', 'prolog',
  ],
  frontend: [
    'react', 'vue', 'angular', 'angularjs', 'svelte', 'sveltekit', 'next.js',
    'nuxt', 'remix', 'gatsby', 'astro', 'redux', 'mobx', 'zustand', 'recoil',
    'rxjs', 'tailwind', 'tailwind css', 'bootstrap', 'material ui', 'mui',
    'chakra', 'ant design', 'shadcn', 'webpack', 'vite', 'rollup', 'parcel',
    'esbuild', 'babel', 'jquery', 'ember', 'backbone', 'knockout',
    'storybook', 'styled components', 'emotion', 'css modules', 'postcss',
    'responsive design', 'web components', 'progressive web apps', 'spa',
    'server side rendering', 'hydration', 'web vitals', 'lighthouse',
    'cross browser', 'dom', 'canvas', 'webgl', 'three.js', 'd3.js',
    'chart.js', 'framer motion', 'react query', 'react router',
  ],
  backend: [
    'node.js', 'express', 'nestjs', 'koa', 'hapi', 'fastify', 'django',
    'flask', 'fastapi', 'tornado', 'celery', 'rails', 'ruby on rails',
    'sinatra', 'laravel', 'symfony', 'codeigniter', 'spring', 'spring boot',
    'hibernate', 'jpa', 'micronaut', 'quarkus', '.net', 'asp.net',
    '.net core', 'entity framework', 'phoenix', 'gin', 'fiber', 'echo',
    'graphql', 'apollo', 'rest', 'rest api', 'restful', 'grpc', 'protobuf',
    'soap', 'websockets', 'socket.io', 'microservices', 'monolith',
    'serverless', 'message queue', 'rabbitmq', 'nginx', 'apache',
    'load balancing', 'rate limiting', 'cron', 'webhooks', 'server side',
  ],
  data: [
    'postgresql', 'mysql', 'mariadb', 'sqlite', 'mssql', 'sql server',
    'oracle', 'mongodb', 'redis', 'memcached', 'cassandra', 'dynamodb',
    'couchdb', 'firestore', 'supabase', 'firebase', 'elasticsearch',
    'opensearch', 'solr', 'neo4j', 'influxdb', 'clickhouse', 'snowflake',
    'bigquery', 'redshift', 'databricks', 'spark', 'pyspark', 'hadoop',
    'hive', 'presto', 'flink', 'beam', 'kafka', 'kinesis', 'pubsub',
    'airflow', 'dagster', 'prefect', 'luigi', 'dbt', 'etl', 'elt',
    'data warehouse', 'data lake', 'data pipeline', 'data pipelines',
    'data modeling', 'data engineering', 'data governance', 'data quality',
    'database design', 'query optimization', 'indexing', 'sharding',
    'replication', 'olap', 'oltp', 'star schema', 'tableau', 'power bi',
    'looker', 'metabase', 'superset', 'excel', 'google sheets',
  ],
  ml: [
    'machine learning', 'deep learning', 'neural networks',
    'convolutional neural networks', 'rnn', 'lstm', 'transformers',
    // `nlp` is NOT listed here on purpose: it lives in ALIASES pointing at this
    // canonical. A key in both maps is a dead alias — see the note on ALIASES.
    'natural language processing', 'computer vision',
    'image classification', 'object detection', 'speech recognition',
    'pytorch', 'tensorflow', 'keras', 'jax', 'scikit-learn', 'pandas',
    'numpy', 'scipy', 'statsmodels', 'matplotlib', 'seaborn', 'plotly',
    'xgboost', 'lightgbm', 'catboost', 'random forest', 'gradient boosting',
    'clustering', 'regression', 'classification', 'time series',
    'forecasting', 'anomaly detection', 'recommendation systems',
    'hugging face', 'large language models',
    'retrieval augmented generation', 'prompt engineering', 'fine tuning',
    'embeddings', 'vector database', 'pinecone', 'weaviate', 'chroma',
    'faiss', 'langchain', 'llamaindex', 'mlops', 'mlflow', 'weights biases',
    'feature engineering', 'feature store', 'model deployment',
    'model evaluation', 'hyperparameter tuning', 'cross validation',
    'reinforcement learning', 'supervised learning', 'unsupervised learning',
    // `a/b testing` can never be matched — `tokenize` splits on `/` and then
    // drops the single letters, leaving the bare token `testing`. It is kept as
    // the canonical written spelling; `ab testing` is the form that matches.
    'transfer learning', 'a/b testing', 'ab testing', 'statistics',
    'probability', 'linear algebra', 'bayesian', 'tfidf',
  ],
  cloud: [
    // `gcp` and `google cloud platform` are NOT listed here on purpose: both
    // are ALIASES onto `google cloud`. See the note on ALIASES.
    'aws', 'azure', 'google cloud',
    'digitalocean', 'heroku', 'vercel', 'netlify', 'cloudflare', 'docker',
    'docker compose', 'kubernetes', 'openshift', 'rancher', 'helm',
    'terraform', 'pulumi', 'ansible', 'chef', 'puppet', 'vagrant',
    'cloudformation', 'jenkins', 'github actions', 'gitlab ci', 'circleci',
    'travis ci', 'bamboo', 'teamcity', 'argocd', 'spinnaker', 'cicd',
    'continuous integration', 'continuous deployment', 'continuous delivery',
    'infrastructure as code', 'devops', 'sre', 'site reliability',
    'prometheus', 'grafana', 'datadog', 'new relic', 'splunk', 'sentry',
    'opentelemetry', 'observability', 'monitoring', 'logging', 'alerting',
    'lambda', 'ec2', 's3', 'rds', 'ecs', 'eks', 'fargate', 'cloudwatch',
    'iam', 'vpc', 'route53', 'api gateway', 'sqs', 'sns', 'step functions',
    'cloud architecture', 'cost optimization', 'linux', 'unix', 'windows server',
  ],
  mobile: [
    'ios', 'android', 'react native', 'flutter', 'swiftui', 'uikit',
    'jetpack compose', 'xamarin', 'ionic', 'cordova', 'capacitor',
    'expo', 'app store', 'google play', 'mobile development',
    'push notifications', 'offline first', 'core data', 'room',
  ],
  design: [
    'figma', 'sketch', 'adobe xd', 'invision', 'framer', 'photoshop',
    'illustrator', 'indesign', 'after effects', 'premiere', 'blender',
    'user research', 'user testing', 'usability testing', 'wireframing',
    'wireframes', 'prototyping', 'mockups', 'design systems',
    'design thinking', 'interaction design', 'visual design', 'ux design',
    'ui design', 'ux', 'ui', 'information architecture', 'accessibility',
    'wcag', 'aria', 'typography', 'color theory', 'branding',
    'motion design', 'illustration', 'journey mapping', 'personas',
    'heuristic evaluation', 'design critique', 'style guide',
  ],
  pm: [
    'agile', 'scrum', 'kanban', 'waterfall', 'safe', 'sprint planning',
    'backlog grooming', 'retrospectives', 'standups', 'jira', 'confluence',
    'asana', 'trello', 'linear', 'notion', 'monday.com', 'roadmap',
    'roadmapping', 'product strategy', 'product discovery',
    'stakeholder management', 'requirements gathering', 'user stories',
    'acceptance criteria', 'okrs', 'kpis', 'product analytics',
    'market research', 'competitive analysis', 'go to market',
    'prioritization', 'resource planning', 'risk management',
    'release management', 'product launch', 'customer interviews',
    'amplitude', 'mixpanel', 'google analytics',
  ],
  practice: [
    'unit testing', 'integration testing', 'end to end testing', 'e2e testing',
    'test automation', 'tdd', 'bdd', 'jest', 'vitest', 'mocha', 'chai',
    'cypress', 'playwright', 'selenium', 'pytest', 'unittest', 'junit',
    'rspec', 'testing library', 'code review', 'pair programming', 'git',
    'github', 'gitlab', 'bitbucket', 'version control', 'branching strategy',
    'debugging', 'profiling', 'performance optimization', 'refactoring',
    'clean code', 'solid principles', 'design patterns', 'api design',
    'system design', 'software architecture', 'distributed systems',
    'event driven architecture', 'domain driven design', 'caching',
    'concurrency', 'multithreading', 'async programming', 'scalability',
    'high availability', 'fault tolerance', 'security', 'appsec',
    'penetration testing', 'threat modeling', 'encryption', 'oauth', 'jwt',
    'saml', 'sso', 'authentication', 'authorization', 'rbac', 'owasp',
    'gdpr', 'soc 2', 'hipaa', 'compliance', 'documentation', 'technical writing',
  ],
  soft: [
    'communication', 'written communication', 'verbal communication',
    'teamwork', 'collaboration', 'cross functional collaboration',
    'leadership', 'people management', 'mentoring', 'coaching',
    'problem solving', 'critical thinking', 'analytical thinking',
    'attention to detail', 'time management', 'organization',
    'adaptability', 'flexibility', 'creativity', 'innovation',
    'presentation', 'public speaking', 'negotiation', 'conflict resolution',
    'empathy', 'customer focus', 'ownership', 'initiative', 'curiosity',
    'decision making', 'influencing', 'facilitation', 'active listening',
    'emotional intelligence', 'resilience', 'multitasking',
  ],
};

/**
 * Flattened vocabulary: surface form → `{canonical, category, weight}`.
 *
 * Built once at module load from {@link RAW_LEXICON}. A Map rather than an
 * object so phrase keys containing dots and dashes stay literal.
 *
 * @type {Map<string, {canonical: string, category: string, weight: number}>}
 */
export const SKILL_LEXICON = new Map();
for (const [category, terms] of Object.entries(RAW_LEXICON)) {
  const weight = CATEGORY_WEIGHTS[category] ?? DEFAULT_CATEGORY_WEIGHT;
  for (const term of terms) {
    // First definition wins, so a term listed in two categories keeps the
    // earlier (more specific) one rather than silently flipping weight.
    if (!SKILL_LEXICON.has(term)) {
      SKILL_LEXICON.set(term, { canonical: term, category, weight });
    }
  }
}

/**
 * Surface form → canonical lexicon key.
 *
 * Applied at TOKEN and PHRASE level only, never as a string replacement: a
 * naive `replace('js', 'javascript')` turns `jsx` into `javascriptx` and `json`
 * into `javascripton`. Every lookup here is against a whole token or a whole
 * space-joined n-gram.
 *
 * ═══ NO KEY HERE MAY ALSO BE A {@link SKILL_LEXICON} KEY ═══
 *
 * `resolveTerm` checks the lexicon FIRST (a literal vocabulary entry should
 * beat a rewrite), so a surface form listed in both maps resolves to itself and
 * its alias never fires. That is silent: "GCP" on a resume and "Google Cloud"
 * in a posting become different canonical terms and the pair scores 0.0 — the
 * exact synonym problem this table exists to solve. The short or abbreviated
 * spelling belongs here; the canonical spelling belongs in the lexicon, once.
 * Every VALUE here must also be a real lexicon key, or the alias is equally
 * dead. `test/matching/lexicon.test.js` enforces both halves.
 *
 * @type {Map<string, string>}
 */
export const ALIASES = new Map([
  ['js', 'javascript'],
  ['ecmascript', 'javascript'],
  ['es6', 'javascript'],
  ['ts', 'typescript'],
  ['py', 'python'],
  ['python3', 'python'],
  ['k8s', 'kubernetes'],
  ['k8', 'kubernetes'],
  ['postgres', 'postgresql'],
  ['psql', 'postgresql'],
  ['pg', 'postgresql'],
  ['mongo', 'mongodb'],
  ['ml', 'machine learning'],
  ['dl', 'deep learning'],
  ['ai', 'machine learning'],
  ['artificial intelligence', 'machine learning'],
  ['nlp', 'natural language processing'],
  ['cv', 'computer vision'],
  ['reactjs', 'react'],
  ['react.js', 'react'],
  ['vuejs', 'vue'],
  ['vue.js', 'vue'],
  ['angular.js', 'angularjs'],
  ['nodejs', 'node.js'],
  ['node', 'node.js'],
  ['nextjs', 'next.js'],
  ['nuxtjs', 'nuxt'],
  ['golang', 'go'],
  ['dotnet', '.net'],
  ['dot net', '.net'],
  // A bare ".net" tokenizes to `net` (leading dots are trimmed), and aliasing
  // `net` would misfire on "net revenue"/"net new", so these spellings are the
  // supported way to reach the .NET entries.
  ['net core', '.net core'],
  ['dotnet core', '.net core'],
  ['gh actions', 'github actions'],
  // Keys containing `/` are never looked up either — every lookup is against a
  // token or a space-joined n-gram, and `tokenize` has already split on the
  // slash by then. They sit next to the spelling that does the work (`ci cd`,
  // `ci-cd`) so the pair is obvious to the next person adding a surface form.
  ['ci/cd', 'cicd'],
  ['ci cd', 'cicd'],
  ['ci-cd', 'cicd'],
  ['tf', 'terraform'],
  ['sklearn', 'scikit-learn'],
  ['scikit learn', 'scikit-learn'],
  ['tf-idf', 'tfidf'],
  ['tf idf', 'tfidf'],
  ['gcp', 'google cloud'],
  ['google cloud platform', 'google cloud'],
  ['amazon web services', 'aws'],
  ['huggingface', 'hugging face'],
  ['llms', 'large language models'],
  ['llm', 'large language models'],
  ['rag', 'retrieval augmented generation'],
  ['cnn', 'convolutional neural networks'],
  ['ssr', 'server side rendering'],
  ['d3', 'd3.js'],
  ['k8s cluster', 'kubernetes'],
  ['restful api', 'rest api'],
  ['rest apis', 'rest api'],
  ['apis', 'rest api'],
  ['api', 'rest api'],
  ['unit tests', 'unit testing'],
  ['integration tests', 'integration testing'],
  // Unreachable for the same reason `a/b testing` is: the single letters are
  // dropped as noise long before the phrase is looked up.
  ['a b testing', 'ab testing'],
  ['test driven development', 'tdd'],
  ['behaviour driven development', 'bdd'],
  ['behavior driven development', 'bdd'],
  ['continuous integration continuous deployment', 'cicd'],
  ['sass/scss', 'sass'],
  ['html5', 'html'],
  ['css3', 'css'],
  ['ux/ui', 'ux'],
  ['ui/ux', 'ux'],
  ['wandb', 'weights biases'],
  ['weights and biases', 'weights biases'],
  ['objective c', 'objective-c'],
  ['obj-c', 'objective-c'],
  ['spring-boot', 'spring boot'],
  ['springboot', 'spring boot'],
  ['tailwindcss', 'tailwind'],
  ['material-ui', 'material ui'],
  ['github-actions', 'github actions'],
  ['gitlab-ci', 'gitlab ci'],
  ['docker-compose', 'docker compose'],
]);

/**
 * Seniority ladder. Values are ordinal, not linear — the gap from senior to
 * lead is not the same as intern to junior — but ordinal is all the fit
 * calculation in `fallbackScore` needs.
 *
 * @type {Record<string, number>}
 */
export const SENIORITY = {
  intern: 0,
  junior: 1,
  entry: 1,
  associate: 1,
  mid: 2,
  intermediate: 2,
  senior: 3,
  sr: 3,
  lead: 4,
  staff: 4,
  principal: 5,
  director: 6,
  head: 6,
  vp: 7,
  chief: 7,
};

/**
 * Tokens that mark a job TITLE rather than a skill. Used to split the title
 * signal out of the keyword signal — "engineer" appearing in a JD says nothing
 * about which stack it uses.
 *
 * @type {Set<string>}
 */
export const TITLE_TOKENS = new Set([
  'engineer', 'developer', 'scientist', 'analyst', 'manager', 'designer',
  'architect', 'consultant', 'specialist', 'administrator', 'lead',
  'director', 'intern', 'researcher',
]);

/**
 * Read a seniority level out of free text.
 *
 * Returns the level of the FIRST seniority token in the string, not the
 * highest. A title reads left to right with the subject's own level first —
 * "Senior Engineer reporting to a Director" is a senior role, and taking the
 * maximum would misread it as a director role. The same holds for JD prose
 * ("Senior Engineer, on the team led by our VP of Platform").
 *
 * Matching is on whole tokens, so "leadership" never reads as `lead`.
 *
 * @param {unknown} text Title or description text; non-strings return null.
 * @returns {number|null} Level from {@link SENIORITY}, or `null` when no
 *   seniority word is present. `null` means unknown, never "junior".
 */
export function detectSeniority(text) {
  const tokens = tokenize(text);
  for (const token of tokens) {
    if (Object.prototype.hasOwnProperty.call(SENIORITY, token)) return SENIORITY[token];
  }
  return null;
}
