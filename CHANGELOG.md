# Changelog

All notable changes to Reqcore are documented here, organized by date.

Format follows [Keep a Changelog](https://keepachangelog.com). Categories: **Added**, **Changed**, **Fixed**, **Removed**.

---

## Unreleased

### Added

* **sidekick:** живой стриминг ИИ в панели — этапы «Читаю→Думаю→Пишу» с секундомером, стрим размышлений reasoning-моделей, partial-рендер верификации и карточки интервью по SSE, кнопка «Стоп», телеметрия TTFT (коммиты 85fb87e, 9c96824, 0df1cfc; дока docs/sidekick-ai-streaming.md)
* **ai-config:** purpose `interactive` для быстрых задач панели (миграция 0068, фолбэк на analysis, кнопка «Использовать для панели» в настройках ИИ)

* **blog:** add Cluster 8 career page articles — pillar (career-page-that-converts) and two supporting articles (career-page-seo, google-for-jobs-structured-data)
* **blog:** add incoming links to career page content from how-applicant-tracking-systems-work, open-source-applicant-tracking-system, and self-hosted-vs-cloud-ats

---

## [1.5.0](https://github.com/VadShv/ats-huntfork/compare/v1.4.0...v1.5.0) (2026-09-05)


### ✨ Features

* **achievements:** gamification module for recruiters ([7a375c0](https://github.com/VadShv/ats-huntfork/commit/7a375c033fcbecd79814f885300dfc60cfc55aac))
* add AI chatbot feature with configuration, access control, and attachment management ([e139b72](https://github.com/VadShv/ats-huntfork/commit/e139b7296c1f3b0275ade32f5f44bac373559bf3))
* add AI chatbot feature with configuration, access control, and attachment management ([912d55d](https://github.com/VadShv/ats-huntfork/commit/912d55d864efee44bf6f17c18c4dff77dfd0a86a))
* add AI configuration seeding and demo data reset script ([927cf1e](https://github.com/VadShv/ats-huntfork/commit/927cf1ed6fea90325e0dadf362b4ab2000c767f3))
* add ApplicationDetailDrawer and CandidateDetailDrawer components ([1371e7d](https://github.com/VadShv/ats-huntfork/commit/1371e7ddfdefb09d152b3945951c5abbce068602))
* add column visibility management to Applications and Candidates views ([a5237a5](https://github.com/VadShv/ats-huntfork/commit/a5237a54448cc5f6de88e2509d44ee3701e96975))
* add db:reseed script and implement demo organization deletion script ([f0f8b2e](https://github.com/VadShv/ats-huntfork/commit/f0f8b2e41ec3fa0c315b5cf9167e89e371da9d3f))
* add Deploy on Railway badge to README, enhance ScoreBreakdown component with caching, and introduce DemoUpsellBanner component ([c372668](https://github.com/VadShv/ats-huntfork/commit/c372668570a16723870868c605382c0876cca3ab))
* add docker entrypoint script to derive NUXT_PUBLIC_* flags from environment variables ([39e098e](https://github.com/VadShv/ats-huntfork/commit/39e098ece0e8823513be402a8d68636bd3ebea3d))
* add Docker support with pre-built image instructions and CI workflow ([753b37e](https://github.com/VadShv/ats-huntfork/commit/753b37ea15eeb3c8ccbe6249d634d736574da13a))
* add Docker support with pre-built image instructions and CI workflow ([6f9223d](https://github.com/VadShv/ats-huntfork/commit/6f9223d520baa5dada4379cd175c78738837d290))
* add document parsing functionality ([e6279d0](https://github.com/VadShv/ats-huntfork/commit/e6279d004612cc1544f1f1c9f957cef55bb4440e))
* add document re-parsing functionality and improve error handling in candidate analysis ([8842c6f](https://github.com/VadShv/ats-huntfork/commit/8842c6fb69b78b3f07326bba98c14032ff7a02e6))
* add documentation for new features including Document Storage, Public Job Board, Application Forms, Dashboard, and Architecture Overview ([2b05075](https://github.com/VadShv/ats-huntfork/commit/2b05075a6a5d5add2cc3660a76833e11bb525a83))
* add documentation for new features including Document Storage, Public Job Board, Application Forms, Dashboard, and Architecture Overview ([625113a](https://github.com/VadShv/ats-huntfork/commit/625113ac8ea9104b6e7803b2edf2d4e644547807))
* add email template management system ([616ada5](https://github.com/VadShv/ats-huntfork/commit/616ada516992a2fd7c33b941b7b12f7a6b5467c0))
* add email template validation schemas and pre-made templates ([7879e38](https://github.com/VadShv/ats-huntfork/commit/7879e38e2e54f7f3ac07d84faec3e36103ea0ded))
* add experience level and quick notes fields to job and candidate schemas ([d36b5a0](https://github.com/VadShv/ats-huntfork/commit/d36b5a07ae2aecb0ffc3faa52eabf5219f8da468))
* add fullscreen toggle functionality to job detail view ([a94e4b6](https://github.com/VadShv/ats-huntfork/commit/a94e4b628922e41154abbeafd351be67e33e5685))
* add functionality to move applications directly to interview stage without scheduling ([22e6a0a](https://github.com/VadShv/ats-huntfork/commit/22e6a0ac2a80c41d5e38ca2164f7cf70fd3c4832))
* add Greenhouse vs Open Source ATS comparison article and enhance existing content with links ([8c2e225](https://github.com/VadShv/ats-huntfork/commit/8c2e2259b71cdf52405378c514594b3feed8b1c1))
* add iCalendar generation for interview invitations ([57e692a](https://github.com/VadShv/ats-huntfork/commit/57e692a253befb4675487e58ef2d5475b284a218))
* add interview scheduling functionality with sidebar integration ([0eb29b0](https://github.com/VadShv/ats-huntfork/commit/0eb29b068d38f04f7289589051e9d53d4c5a2f57))
* add interview validation schemas for creation, updating, and querying ([a93da4e](https://github.com/VadShv/ats-huntfork/commit/a93da4ec16862dacd43ebb9efbb339a84492f502))
* add interview validation schemas for creation, updating, and querying ([be8f623](https://github.com/VadShv/ats-huntfork/commit/be8f62375cb7a5798f9133dcf454eea7f835617b))
* add interviews dashboard page with filtering, editing, and deleting functionalities ([59bdb36](https://github.com/VadShv/ats-huntfork/commit/59bdb36d5ba33a280f20c39ceb9b9eb53fa2eeec))
* add middleware for 301 redirect from legacy domain to canonical domain ([5525cf6](https://github.com/VadShv/ats-huntfork/commit/5525cf6efa0c7e94220f58d2af2e7cf5e145affd))
* add new article on ATS functionality and update topical authority map ([8e282cd](https://github.com/VadShv/ats-huntfork/commit/8e282cdae8443b0543233946ffafdbaaa2e3ae3e))
* add new article on best free ATS software for startups and update related content ([021f8db](https://github.com/VadShv/ats-huntfork/commit/021f8db2351260cd5e2ac738aa571da85e91f4dc))
* add new article on the differences between open source and free ATS, including a comprehensive guide and internal links ([da31e77](https://github.com/VadShv/ats-huntfork/commit/da31e77ba6187f7c8faa6ddb1d626c1fdfe57d82))
* add new migration entries for candidate demographics organization settings and salary negotiable ([36e3e81](https://github.com/VadShv/ats-huntfork/commit/36e3e8171fc367c89afe17c38522e0ea447e0911))
* add Nitro plugin to recompute public auth-provider flags at server startup ([6b7b699](https://github.com/VadShv/ats-huntfork/commit/6b7b6999a6c12f21009f8bd9b474412fdf86c9fc))
* add OIDC SSO environment validation and unit tests ([1b23af3](https://github.com/VadShv/ats-huntfork/commit/1b23af31b04d150e277701401e29424a07f9b8a8))
* add organization localization settings and candidate demographics ([f828877](https://github.com/VadShv/ats-huntfork/commit/f828877ff1090cc9001ede9e5be3cfdfa26cec7f))
* add pgDumpEnv utility to secure environment variable handling ([6fe4900](https://github.com/VadShv/ats-huntfork/commit/6fe490000487779ad008277ee650ded375bdbcf9))
* add property management utilities and schemas ([a62eea1](https://github.com/VadShv/ats-huntfork/commit/a62eea1f5644ba0cd4cd892cea14a376746994ce))
* add property management utilities and schemas ([4dc5aad](https://github.com/VadShv/ats-huntfork/commit/4dc5aad0252a67306633b9f63e56d9d5737bce7d))
* add raw tag support for Docker image publishing ([29775cb](https://github.com/VadShv/ats-huntfork/commit/29775cb1b17d560f76bfe2e73e5d5dc2c5d99a9c))
* add realistic interview data and scheduling logic to seed script ([e3b1881](https://github.com/VadShv/ats-huntfork/commit/e3b188148eaf7bb484bff148b8cbe45a8eda1cb8))
* add realistic interview data and scheduling logic to seed script ([467cc56](https://github.com/VadShv/ats-huntfork/commit/467cc56a98504d53445e0538526a63f572a60602))
* add release automation configuration and update versioning ([a37c1cc](https://github.com/VadShv/ats-huntfork/commit/a37c1cc8f032816ab10a184ad3b487d65b5997a7))
* add robots.txt for SEO optimization and allow indexing of job board pages ([0c387ba](https://github.com/VadShv/ats-huntfork/commit/0c387ba70d0c46b26253f0fe62c26be72f7af2ca))
* add salary input change handlers and update permissions for organization ([6c238c2](https://github.com/VadShv/ats-huntfork/commit/6c238c2fae2341639bde2f961ba1bbd36708044f))
* add script to backfill google_calendar_event_link for existing interviews ([c46d13d](https://github.com/VadShv/ats-huntfork/commit/c46d13da86b1bd5937b354647e98bf7e3561fe61))
* add Settings page for job management and update job tabs in AppTopBar ([7dba4da](https://github.com/VadShv/ats-huntfork/commit/7dba4dac492d31a75b2d5faab176cbe4a693960f))
* add site origin computation for dynamic redirect URI in SSO setup ([9e5aa68](https://github.com/VadShv/ats-huntfork/commit/9e5aa688006e9254bc44f4c93c180c300ed9ad12))
* add Source Tracking page with initial layout and SEO metadata ([750dc0b](https://github.com/VadShv/ats-huntfork/commit/750dc0bed5eb0daa790453ac7013485b525a7fa4))
* add SSO provider schema and relations for better authentication integration ([62fdf39](https://github.com/VadShv/ats-huntfork/commit/62fdf399d79132e30889ded51b312642454de2f9))
* add teleport target prop to modals for improved flexibility in rendering ([78a3ae8](https://github.com/VadShv/ats-huntfork/commit/78a3ae8729fff28622104a7e8cdbca4d66c27dd7))
* add tracking link schemas for creation, update, and querying ([9d60aaf](https://github.com/VadShv/ats-huntfork/commit/9d60aaf694787a6e65f527fed313535a312aa808))
* add tracking link schemas for creation, update, and querying ([558e054](https://github.com/VadShv/ats-huntfork/commit/558e054d71a8f8fc496d02f6876220ebf3f3bf83))
* add use case guide for open source ATS adoption by company size and industry ([f9770e5](https://github.com/VadShv/ats-huntfork/commit/f9770e56d947f6b1ca9e387febcb2cebc6115e68))
* add WordExtractor type declarations and update document permissions ([6f66efd](https://github.com/VadShv/ats-huntfork/commit/6f66efdbf34dbf38f1c6867dd9995f8001047dc3))
* **ai-analysis:** add AI analysis dashboard and stats endpoint with tests ([c09ea21](https://github.com/VadShv/ats-huntfork/commit/c09ea21741f63bf7b3c175418ff6ab552489c2d3))
* **ai-config:** add connection test functionality and update AI settings UI ([c9f4afd](https://github.com/VadShv/ats-huntfork/commit/c9f4afd15b8787ce4c9414db2bde7a21ed3ffc10))
* **ai:** enhance AI scoring and configuration with rate limiting and error handling improvements ([71f0185](https://github.com/VadShv/ats-huntfork/commit/71f0185d55c029cd8e20525828b4d196a426bd73))
* **ai:** separate model purpose for resume structuring ([c0a57e8](https://github.com/VadShv/ats-huntfork/commit/c0a57e86347c94dce9cab30c3000b3cca93e40c6))
* **ai:** Yandex Cloud provider — поддержка YandexGPT и других моделей ([b9cb0b6](https://github.com/VadShv/ats-huntfork/commit/b9cb0b64e15d55900a37c04cb88653fc23f2672c))
* **analytics:** enhance PostHog consent management and user identification for GDPR compliance ([0632620](https://github.com/VadShv/ats-huntfork/commit/063262098bc4172c8ddecf6fa5a5740e45a9b338))
* **analytics:** integrate PostHog for user analytics and consent management ([8bd4bd5](https://github.com/VadShv/ats-huntfork/commit/8bd4bd50cb62254e9d39f8c92214c2af24b8671c))
* **analytics:** integrate PostHog for user analytics and consent management ([619f239](https://github.com/VadShv/ats-huntfork/commit/619f239c06a865a2d1a091a1d5f85a941548b5a7))
* **api:** add candidate timeline endpoint and tracking link stats endpoint ([46e1e15](https://github.com/VadShv/ats-huntfork/commit/46e1e154b5346f90b9bad0cd46ba7665f300aa04))
* **api:** hh webhooks, assistant, communications, pipeline stages ([a313445](https://github.com/VadShv/ats-huntfork/commit/a31344502de8c1b3420027c8bf1acaac11d55683))
* **applications:** Sprint 1B — серверный FTS на странице откликов ([da05a84](https://github.com/VadShv/ats-huntfork/commit/da05a841e9fb88ef8549419cee177df23871dfda))
* **applications:** разграничение «отклик vs холодный» — иконки источника + тумблер «Скрыть холодных» ([986abef](https://github.com/VadShv/ats-huntfork/commit/986abef13e86920e3857ef9dab798b67bf62b346))
* **AppTopBar:** remove unused transition classes for user menu ([49976c3](https://github.com/VadShv/ats-huntfork/commit/49976c38d587ee05c09b59dd2226632529cadb33))
* **auth:** add fresh signup page with redirect functionality ([f0ae97f](https://github.com/VadShv/ats-huntfork/commit/f0ae97f93ced497b3544615d7cebaaef8fc5cb57))
* **auth:** enhance error handling for sign-in and sign-up processes, including BETTER_AUTH_URL mismatch detection ([dd29c49](https://github.com/VadShv/ats-huntfork/commit/dd29c4949feb422d54a75097dfb3517bbae1bf2e))
* **auth:** improve BETTER_AUTH_URL handling for Railway environments and enhance validation ([e368cc8](https://github.com/VadShv/ats-huntfork/commit/e368cc8834bd07f0fe5674e9f25960d5b43224a1))
* **auth:** improve BETTER_AUTH_URL handling for Railway environments… ([ef155aa](https://github.com/VadShv/ats-huntfork/commit/ef155aa8f35666f5ec129f2bb288365581a43138))
* **auto-reject:** backend — авто-отклонение по AI-скору (этапы 1-5) ([a31f395](https://github.com/VadShv/ats-huntfork/commit/a31f39555a7d9e4daa368e69f3625e29b3c15f79))
* **auto-reject:** UI — настройки, бейджи, фильтр, i18n (этапы 6-8) ([f44f51d](https://github.com/VadShv/ats-huntfork/commit/f44f51da782d315751f5599f09d49a1e90c9d455))
* **automation:** блок автоматизации в настройках + тумблер в отклике + фикс ИИ-скрининга hh-сорсинга ([be4fcf7](https://github.com/VadShv/ats-huntfork/commit/be4fcf7f679c67af42cc08882e3d548596d94383))
* **brand:** \u0431\u0440\u0435\u043d\u0434\u0438\u043d\u0433 \u0413\u0440\u0443\u043f\u043f\u044b \u0410\u0441\u0442\u0440\u0430 (\u042d\u0442\u0430\u043f 6.5) ([1ee4c3b](https://github.com/VadShv/ats-huntfork/commit/1ee4c3b88d496a0d03a2c62948a3972ad43f9542))
* **brand:** favicon — Сокол без кольца (SVG + PNG fallback) ([80c02ce](https://github.com/VadShv/ats-huntfork/commit/80c02ce0edb160142d28781c2363f52d1ce71e10))
* **brand:** новый Сокол — иконка вкладки и кликабельная эмблема ([6cb0ed8](https://github.com/VadShv/ats-huntfork/commit/6cb0ed8932ce312b759b0a8e2ce4c91447e93e2e))
* **brand:** переименование ReqCore Astra → Huntfork + чистка GitHub-упоминаний ([24f8a14](https://github.com/VadShv/ats-huntfork/commit/24f8a14f464013807e5ac93bfb12fd34a72f05f0))
* **calendar:** add Google Calendar integration with OAuth2 flow ([08f778a](https://github.com/VadShv/ats-huntfork/commit/08f778a49feacfd41f3b78853b66251998bd499f))
* **calendar:** add Google Calendar sync status indicators in interview components ([bb5244a](https://github.com/VadShv/ats-huntfork/commit/bb5244adc2ce0e61e1ecd9b7f8a725de675ede66))
* **calendar:** update webhook renewal to require specific permissions and enhance error handling in sync process ([140d6ac](https://github.com/VadShv/ats-huntfork/commit/140d6ac690b0752d6205035df0d069f61ec2e418))
* **candidate:** full-width шапка с идентификацией кандидата ([fa1de16](https://github.com/VadShv/ats-huntfork/commit/fa1de16eeb28ba04cc8f0e5db89fc7af4e22c96c))
* **candidate:** master-profile — auto resume versioning, promote, attach-document ([e1481ff](https://github.com/VadShv/ats-huntfork/commit/e1481ff6551ae922b7598198f60e7e6d1657db5b))
* **candidates:** Sprint 1A — full-text поиск + метки в индексе + подсветка ([58d2b51](https://github.com/VadShv/ats-huntfork/commit/58d2b5138f75e27655a4532f4b5e35cd98b4e21c))
* **candidates:** холодный флоу — загрузка резюме при создании ([5edb61f](https://github.com/VadShv/ats-huntfork/commit/5edb61f683ee57018ecff6f889b1a0362021e20c))
* **candidate:** новая карточка в стиле Хантфлоу — резюме с hh, AI-саммари, скачивание + backfill ([6337671](https://github.com/VadShv/ats-huntfork/commit/6337671501f04a62130a4d5ae8e5d725714f1f20))
* **candidate:** объединить «Слить», «Фрод» и «Ручная проверка» в dropdown «Другое» ([f5271ec](https://github.com/VadShv/ats-huntfork/commit/f5271ec62bd7a471270d58dd1f807d15e8964000))
* centralize system email templates in shared module for improved maintainability ([e05b877](https://github.com/VadShv/ats-huntfork/commit/e05b8778defb25981658bdf197ff311d43f0cb71))
* **chatbot:** full-text поиск кандидатов по тексту резюме + фильтр по статусу ([a582759](https://github.com/VadShv/ats-huntfork/commit/a58275947979ec11fd2c83962b1490c36872ebf5))
* **chatbot:** hiring_summary tool + jobId опционален в list_applications ([8aadeca](https://github.com/VadShv/ats-huntfork/commit/8aadeca91aef6935d10d895c2f7b05a9bb9bfa56))
* **chatbot:** русская локализация страницы ассистента ([11bd741](https://github.com/VadShv/ats-huntfork/commit/11bd74194ad0db26c59db1779096769f2212ff5c))
* **chatbot:** убран feature-flag, добавлена кнопка-быстрый доступ в шапке ([c1c9728](https://github.com/VadShv/ats-huntfork/commit/c1c9728d429b18a92e056d6338b8800b61afafdf))
* **collab-thread:** Sprint A — тред обсуждения откликов с @-упоминаниями ([41c07b8](https://github.com/VadShv/ats-huntfork/commit/41c07b8d98ce692544ccf1dd85a1495f7f7f5727))
* **collab-thread:** Sprint B — реакции, вложения и уведомления ([9bfb883](https://github.com/VadShv/ats-huntfork/commit/9bfb88357b54a81d80fa034f50b2b6f6bbc77c0b))
* **collab-thread:** Sprint C — тред в drawer откликов, проверка is_internal ([8099a13](https://github.com/VadShv/ats-huntfork/commit/8099a13639c5089f13cb239e3221e0502a8718f9))
* **collab-thread:** разрешить self-mention уведомления ([5dffa3d](https://github.com/VadShv/ats-huntfork/commit/5dffa3db129c8a9c2098422a085b46e46452b047))
* **collab-thread:** стикеры в комментариях ([fd24087](https://github.com/VadShv/ats-huntfork/commit/fd24087c167f070ad4c25112281e4f60f747e5b1))
* **consent:** implement consent banner for analytics tracking and update privacy policy ([24a9201](https://github.com/VadShv/ats-huntfork/commit/24a920163ecf9a3a9a65d4476f115dd34357a34b))
* **consent:** simplify consent message for clarity in analytics tracking ([c28356a](https://github.com/VadShv/ats-huntfork/commit/c28356a27eea15715e686cd83686ac7cdb6bd29b))
* **consent:** update wording in consent banner for improved clarity ([91c6550](https://github.com/VadShv/ats-huntfork/commit/91c655032d8e3cf515b065b9fe13e216f460c90d))
* create HMAC-signed tokens for candidate interview responses ([57e692a](https://github.com/VadShv/ats-huntfork/commit/57e692a253befb4675487e58ef2d5475b284a218))
* **dark mode:** enhance checkbox and radio styles for dark mode rendering ([728feb2](https://github.com/VadShv/ats-huntfork/commit/728feb2443087d893feacc7e0afa3db12c9ed5b0))
* **dashboard:** enhance job management and pipeline tracking ([a60f489](https://github.com/VadShv/ats-huntfork/commit/a60f4893a633768525adfdea7eaf1ed5b5a17f50))
* **dashboard:** update job pipeline display logic to use application count ([b75b0e5](https://github.com/VadShv/ats-huntfork/commit/b75b0e51442fa7d96b2d5bd07ea77baa5debd3eb))
* **database:** enhance database URL resolution with fallback handling for environment variables ([0302102](https://github.com/VadShv/ats-huntfork/commit/0302102c984b04642cd2e4de2bbb4cdcdf88b185))
* **db:** миграции 0048–0055 — pipeline 1:1 hh, activity, comms, webhooks, assistant ([ff4dc01](https://github.com/VadShv/ats-huntfork/commit/ff4dc0172fe02f9f4259308aac4da6c60f1c77b3))
* **dedup:** \u0432\u0435\u0440\u0441\u0438\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435 \u0440\u0435\u0437\u044e\u043c\u0435 \u0441 \u0434\u0435\u0431\u0430\u0443\u043d\u0441\u043e\u043c \u0438 \u0434\u0435\u043b\u044c\u0442\u043e\u0439 (\u042d\u0442\u0430\u043f 2) ([2aa48b2](https://github.com/VadShv/ats-huntfork/commit/2aa48b28c425f888df51c017e935a26eeaeff272))
* **dedup:** fuzzy-матчинг и фрод-предупреждение (Этап 3) ([b73e838](https://github.com/VadShv/ats-huntfork/commit/b73e838dcd44df93af389b538ec0e26407976c7e))
* **dedup:** Sprint 2 — rollback merge, склейка истории стадий, дополнение существующего (P1.1+P1.2+P1.3) ([c3f8820](https://github.com/VadShv/ats-huntfork/commit/c3f8820a60951c4346399930cfe68bc0cdd5e96c))
* **dedup:** Sprint 3 (P2) — соцсети, города, employer-сигнал, hh_owner-приоритет, fuzzy-recalc on PATCH ([e424ff0](https://github.com/VadShv/ats-huntfork/commit/e424ff0408d81a21009ad95ced7f557b9b83343a))
* **dedup:** Sprint 4 — UX-улучшения дедупа (P3.1-P3.6) ([5fc5a7b](https://github.com/VadShv/ats-huntfork/commit/5fc5a7b481d8e553174be7066e33fa81e454d4d8))
* **dedup:** UI слияния и дашборд дублей (Этап 4) ([57d8109](https://github.com/VadShv/ats-huntfork/commit/57d8109ee2772938447a95d5eba5537e36828805))
* **dedup:** детект дублей при ручном создании кандидата ([a76230f](https://github.com/VadShv/ats-huntfork/commit/a76230f1aaf6e32cfdb715a7dba43da036d13f39))
* **dedup:** журнал слияний (Этап 5) ([d7360fd](https://github.com/VadShv/ats-huntfork/commit/d7360fdf0036dc0fcb91a024ce2b1f577a5491f7))
* **dedup:** кнопка ручного merge с карточки кандидата ([7910913](https://github.com/VadShv/ats-huntfork/commit/7910913f7ad0de7c67da3e58057d05c5314749a8))
* **dedup:** проверка возможных дублей после раскрытия hh-контактов (Sprint 2) ([c03d1ae](https://github.com/VadShv/ats-huntfork/commit/c03d1aefa589545524fde3c2a883f958dfaa63ea))
* **dedup:** фундамент дедупликации — organization_group, candidate_identity, merge_log ([fa63ce2](https://github.com/VadShv/ats-huntfork/commit/fa63ce290ab65dd3b98f8b3cbdd5860c3f56f0a3))
* **delete-demo-org:** invalidate sessions for demo organization before deletion ([b8ee811](https://github.com/VadShv/ats-huntfork/commit/b8ee81198f8f558ab921684ef1b27495fab0ab67))
* **demo:** add 'Get Started' options for demo mode in AppTopBar and enhance PreviewUpsellModal ([8c530cf](https://github.com/VadShv/ats-huntfork/commit/8c530cf58f90932d915e8ffd5bec2f07b83d6997))
* **demo:** add 'Get Started' options for demo mode in AppTopBar and enhance PreviewUpsellModal ([e607520](https://github.com/VadShv/ats-huntfork/commit/e607520af5e118a32c7e0bf496d90642fe471831))
* **dependencies:** update PostHog CLI and related packages for improved functionality ([f532a3e](https://github.com/VadShv/ats-huntfork/commit/f532a3e3c53d522b1d11c93314cf91252400a6f3))
* **docker:** add CHANGELOG.md to Docker image for runtime access ([b7af4ce](https://github.com/VadShv/ats-huntfork/commit/b7af4ce41414bcca89ee3b51f9fbe62ff944463d))
* **duels:** 1v1 weekly recruiter challenges (stage E2) ([a504f4e](https://github.com/VadShv/ats-huntfork/commit/a504f4ed25e6d8852e8ffcda89fa6fc37d295cc4))
* **economy:** coins + cosmetics shop (stage F) ([d05d367](https://github.com/VadShv/ats-huntfork/commit/d05d367ab95c2872e4166e9e0b4282b70728a1db))
* enhance analytics consent management with cross-domain linking and event buffering ([7a9dd82](https://github.com/VadShv/ats-huntfork/commit/7a9dd82ede3ae275c97f66ebbcd8efba0d0b6353))
* enhance analytics event handling by flushing pending events on consent and organization creation ([2212af8](https://github.com/VadShv/ats-huntfork/commit/2212af82b1d7ebb949bd3a50014fb40dd55ce8a9))
* enhance authentication security with stricter password policy, email verification, and session management ([aaae17f](https://github.com/VadShv/ats-huntfork/commit/aaae17f66c6ee3f669843526c38d9f38983aa662))
* enhance color mode functionality and improve UI responsiveness ([8068e4e](https://github.com/VadShv/ats-huntfork/commit/8068e4ec7eecb6c087d6ae45e6ce2a3e6c60374e))
* enhance event tracking by persisting pending events in sessionStorage ([95c48ce](https://github.com/VadShv/ats-huntfork/commit/95c48cee281e4a35b0f237bcb88668812ed13011))
* enhance forgot password functionality and improve SSRF protection ([8e0abd6](https://github.com/VadShv/ats-huntfork/commit/8e0abd6efcc1b1ad8bceacd32491d46909fea46c))
* enhance interview management with inline editing and rescheduling features ([ef5cdbb](https://github.com/VadShv/ats-huntfork/commit/ef5cdbb68a2421c6c00c080edece1e93406417ff))
* enhance invitation handling in authentication flow ([9d97557](https://github.com/VadShv/ats-huntfork/commit/9d975570c63669ab37edfecd585b656dc2186c2f))
* enhance language switcher component and update locale configurations with partial translations ([94b5cda](https://github.com/VadShv/ats-huntfork/commit/94b5cda961e90dfd6947e7082f671b68d523492e))
* enhance LanguageSwitcher component with drop-up option and impr… ([5aea684](https://github.com/VadShv/ats-huntfork/commit/5aea684d31412734786fd96b7816fc9322865936))
* enhance LanguageSwitcher component with drop-up option and improve layout for candidate and job detail pages ([ccc829e](https://github.com/VadShv/ats-huntfork/commit/ccc829ea2f757a9beb1f8be9c317fb435ca0106a))
* enhance mobile responsiveness and scrollbar visibility across components ([ab939bb](https://github.com/VadShv/ats-huntfork/commit/ab939bbd644264608e6788cfe48d04f71bb279d0))
* enhance mobile responsiveness and scrollbar visibility across components ([5ecc098](https://github.com/VadShv/ats-huntfork/commit/5ecc098d777b2141c696d4687f3baa54c96de4b3))
* enhance OIDC endpoint origin fetching to directly inject discovered origins into trusted-origins list ([ee34d86](https://github.com/VadShv/ats-huntfork/commit/ee34d86125e3de07b2ca0e200c52f94c4d8f87a2))
* Enhance PostHog proxy handling with explicit header management and error handling ([8b9ea20](https://github.com/VadShv/ats-huntfork/commit/8b9ea205c32b86e43268d2ffb26cc6972a9855cb))
* enhance property management with new color variables and update component interactions ([349ec6a](https://github.com/VadShv/ats-huntfork/commit/349ec6a76f2bec70a0b1410e1c8fdd990fa28600))
* enhance PropertyFilterBar and PropertySchemaEditor with improved element references and state management ([cd7524e](https://github.com/VadShv/ats-huntfork/commit/cd7524e4b7d716dc4c732ee88ca60d4c66c91c7e))
* enhance resume parser with PDF polyfills and dynamic import for pdf-parse ([2d6dea5](https://github.com/VadShv/ats-huntfork/commit/2d6dea5bb7a2d92150cca330cbd334526cd619e4))
* enhance SSO sign-in and sign-up error handling, and enforce email requirement in profile mapping ([76c54b4](https://github.com/VadShv/ats-huntfork/commit/76c54b4026eb3de9e5aa6de57eaf682393f24a27))
* enhance timeline functionality with collapsible sections and candidate grouping ([b8c6ab9](https://github.com/VadShv/ats-huntfork/commit/b8c6ab91f9b8d5dcb8e71186b4c10198ea394a10))
* enhance trusted origins resolution for CSRF checks and OIDC discovery ([3c24417](https://github.com/VadShv/ats-huntfork/commit/3c244175cd07e428624217a6d609bd5d3ae155a5))
* enhance trusted origins resolution for SSO provider registration ([b5832b6](https://github.com/VadShv/ats-huntfork/commit/b5832b64c975c9dab88ba2a3b84208758bb1fbc9))
* enhance webhook handling with cron secret validation and improve interview ID validation ([457af10](https://github.com/VadShv/ats-huntfork/commit/457af10fe8f160c066e7ae4611e8c0e5a5e3b8a0))
* enhance workflows and documentation for release process, including PR title linting and release verification ([4785db5](https://github.com/VadShv/ats-huntfork/commit/4785db56bd7d282ce28f63a18f3687c976c525e0))
* **extension-api:** серверные эндпоинты для Sidekick — воронка, шаблоны, статистика, верификация, карта поиска, карточка интервью ([d2be597](https://github.com/VadShv/ats-huntfork/commit/d2be59783335c464a06f3c6a17be954300714a9f))
* **extension:** бэк для Chrome-расширения ручного сорсинга ([5abfd3d](https://github.com/VadShv/ats-huntfork/commit/5abfd3d0f43f7175bfcf94eaccafa15989154cda))
* **gamification:** metrics summary + primary recruiter + reorganize league tabs ([a36e393](https://github.com/VadShv/ats-huntfork/commit/a36e393aec703f367edce7e98fb989e2cbde2212))
* **gamification:** split «Лига рекрутеров» into Прогресс/Команда/Магазин tabs ([5389c7b](https://github.com/VadShv/ats-huntfork/commit/5389c7bd71651f5328305596324a4934a328819e))
* **gamification:** unify «Лига рекрутеров» settings hub (stage G3) ([29555b0](https://github.com/VadShv/ats-huntfork/commit/29555b0e6e951cf1f40afe415ea66c7f5ec05411))
* **google-calendar:** update integration instructions and add environment variable details ([be9ccbd](https://github.com/VadShv/ats-huntfork/commit/be9ccbd669c19f5eb9d60241abe3f70080246eac))
* **hh:** \u044d\u0442\u0430\u043f 1 \u2014 OAuth-\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 hh.ru ([fd8c00d](https://github.com/VadShv/ats-huntfork/commit/fd8c00db19297c6c2253e033b72ce65ffbbf1e0d))
* **hh:** привязка/отвязка существующей вакансии к hh.ru ([a1a2b0f](https://github.com/VadShv/ats-huntfork/commit/a1a2b0fd137b0ad58413975043914d65e6135068))
* **hh:** сорсинг hh.ru (Joon-like) — S1→S6 ([e143e87](https://github.com/VadShv/ats-huntfork/commit/e143e87d5ae5c140751c0dedffa4cd2523790c93))
* **hh:** этап 2 — импорт вакансии с hh.ru по ссылке ([96e7552](https://github.com/VadShv/ats-huntfork/commit/96e755245d9bb17881758ee882ecbcf6c481990f))
* **hh:** этап 3 — фоновый синк откликов hh.ru ([ca99326](https://github.com/VadShv/ats-huntfork/commit/ca993269430e96afeab572a960c2d647e6d20f23))
* **hh:** этап 4 — кнопка «Обработать всё/выборочно» для скоринга откликов ([359c967](https://github.com/VadShv/ats-huntfork/commit/359c967c53986a879f8533e10f138c47214b143a))
* **hm:** приглашение НМ через invite-link в Настройках → Участники ([d0350c5](https://github.com/VadShv/ats-huntfork/commit/d0350c591a0d40d774e005c3a33ee9aecf2fd3cd))
* **hm:** Спринт 20.4 — фронт для роли Нанимающий менеджер ([03aaec8](https://github.com/VadShv/ats-huntfork/commit/03aaec812a347dfec267d784c1566adb531b7c4e))
* **huntpass:** seasonal track — SXP, tiers, rewards (Phase 1) ([11a53a4](https://github.com/VadShv/ats-huntfork/commit/11a53a4c3cbf56f576a66341929e55a389d3e48d))
* **i18n:** добивка перевода — вкладка ИИ-анализ + страница отклика ([225ca32](https://github.com/VadShv/ats-huntfork/commit/225ca323aefce8b8782c0f989a6c035198329bce))
* **i18n:** полный перевод UI на русский — устранение хардкодов ([8d5f946](https://github.com/VadShv/ats-huntfork/commit/8d5f946c9fd71d4c0494a272da343e2eb414e00d))
* **i18n:** хвосты перевода — Sidebar drawer + applications/[id] статусы ([71dd5e5](https://github.com/VadShv/ats-huntfork/commit/71dd5e5cdaf5b8c70133fb7e003369423fe6c67a))
* implement advanced filtering and sorting options for job applications ([27f179e](https://github.com/VadShv/ats-huntfork/commit/27f179ec274545fb485cfc9aad56b986415a2ad7))
* Implement AI scoring system with provider integration and criteria management ([6ba3159](https://github.com/VadShv/ats-huntfork/commit/6ba31596f7fe239611901b99c2c60f430166e84a))
* Implement AI scoring system with provider integration and criteria management ([8158718](https://github.com/VadShv/ats-huntfork/commit/8158718f8421903c5df639bb5731f6361d39685f))
* implement autoScoreApplication for AI-driven application scoring ([5222980](https://github.com/VadShv/ats-huntfork/commit/5222980ea02aa92fa44b048157717bc23c3e370a))
* implement combined demo-check and sign-out endpoint for fresh sign-up flow ([a5632bd](https://github.com/VadShv/ats-huntfork/commit/a5632bd865610f6f1a4fb9196df9b95d06d9db93))
* implement demo-aware signup redirect with server-side session check ([092d324](https://github.com/VadShv/ats-huntfork/commit/092d3241a96ff78b7ddc9068c1c0f8bfac6e00ba))
* implement forgot password and reset password functionality ([aa00e89](https://github.com/VadShv/ats-huntfork/commit/aa00e8947d5c0b37410971624d3e036504ca8ceb))
* implement forgot password and reset password functionality ([ad864ef](https://github.com/VadShv/ats-huntfork/commit/ad864efff2456ad08aa7038d7f1e9a312263d9a9))
* implement internationalization for navigation and hero sections across multiple languages ([7720fc8](https://github.com/VadShv/ats-huntfork/commit/7720fc85fb3dba24fda9f87dc595522e235504ef))
* implement invitation acceptance page with auto-accept functionality ([1fd295b](https://github.com/VadShv/ats-huntfork/commit/1fd295bc13a7767bad0ebef2c6680141a79b7bd5))
* implement nonce-based CSP middleware for enhanced security ([bfb4483](https://github.com/VadShv/ats-huntfork/commit/bfb44830d3205dc9e8c5392fdabdb8da4ed37a5e))
* implement nonce-based CSP middleware for enhanced security ([6fe4900](https://github.com/VadShv/ats-huntfork/commit/6fe490000487779ad008277ee650ded375bdbcf9))
* implement OIDC endpoint origin prefetching for trusted origins resolution ([9c355ab](https://github.com/VadShv/ats-huntfork/commit/9c355abc6720fe129255107462472fada48ba76e))
* implement server-side demo organization check for fresh sign-up flow ([3075a17](https://github.com/VadShv/ats-huntfork/commit/3075a17cb9d87c64a81d947bd51efb5e99f34583))
* implement social sign-in for Google, GitHub, and Microsoft with configuration support ([d4ceaf8](https://github.com/VadShv/ats-huntfork/commit/d4ceaf811134d881af5fe74d70db78d85717f802))
* implement social sign-in for Google, GitHub, and Microsoft with configuration support ([0e4d4bd](https://github.com/VadShv/ats-huntfork/commit/0e4d4bd686c9c7014a149289f2e87b2c359c395d))
* implement sortable candidate and application tables with improved UI ([9188d3b](https://github.com/VadShv/ats-huntfork/commit/9188d3b5bb6dcdb4f105ae35a2c009721317a9f9))
* implement Timeline page with activity log and infinite scroll functionality ([5b1c694](https://github.com/VadShv/ats-huntfork/commit/5b1c6941af4b4f203cc9ad0a784bce01b7e25017))
* implement Timeline page with activity log and infinite scroll functionality ([abda1a3](https://github.com/VadShv/ats-huntfork/commit/abda1a3e325feb919d51e6887d0bf69c7c76bb0e))
* implement tracking for various user actions and API events in the application ([674993c](https://github.com/VadShv/ats-huntfork/commit/674993c330ee1c3200015e8a51d243cfa662d40c))
* Implement two-tier consent model for PostHog analytics ([0d51cd5](https://github.com/VadShv/ats-huntfork/commit/0d51cd53dbae1c20267a04220f2b6bd42e3ae2c9))
* Implement two-tier consent model for PostHog analytics ([ef7fee5](https://github.com/VadShv/ats-huntfork/commit/ef7fee50cfa5cf0fa079f264453cdba873fa97df))
* implement unique default chatbot agent constraint and enhance related logic for attachment management ([f11a78f](https://github.com/VadShv/ats-huntfork/commit/f11a78fced7dcc82e1a98bce28b94f2010bfe705))
* improve date formatting helper to return local timezone date string ([ddda624](https://github.com/VadShv/ats-huntfork/commit/ddda62492e58a38a79eb5f67a46311f32a0d6c58))
* improve demo organization check by ensuring demo slug is validated before redirecting ([b60b9bc](https://github.com/VadShv/ats-huntfork/commit/b60b9bc9a102c4086fb30cc32b0d90d057aaecea))
* improve edit element reference handling in PropertyFilterBar ([486d0e1](https://github.com/VadShv/ats-huntfork/commit/486d0e148b7a10ba36d59931c776a26ea6b1ee77))
* integrate email template selection for interview invitations ([771917f](https://github.com/VadShv/ats-huntfork/commit/771917fd9b180b4babcfb6eb0c0192c4b5e44ebb))
* **interview:** add Google Calendar notification preferences and customization options ([6c942d0](https://github.com/VadShv/ats-huntfork/commit/6c942d0b6015f0a74d60c74612d8392e1ea6c4b4))
* **interview:** enhance interview scheduling with Google Calendar integration and email validation ([58810b1](https://github.com/VadShv/ats-huntfork/commit/58810b17e10064336d80a8de508a043070e7963d))
* **interviews:** add Interview interface for managing interview data structure ([da4e78d](https://github.com/VadShv/ats-huntfork/commit/da4e78dc6552b14201432429229a10363eaf5748))
* **jobs:** add remote status and experience level fields to job creation form ([405ee5b](https://github.com/VadShv/ats-huntfork/commit/405ee5bb9c2f7b7123ef6067855403b05410e869))
* **jobs:** enhance job application form with AI integration warnings and improved field descriptions ([2bcae86](https://github.com/VadShv/ats-huntfork/commit/2bcae86ee89f51364f11a406ec2b26ff6ffcd936))
* **jobs:** автодогрузка всех откликов батчами (без лимита 500) ([95a0b7f](https://github.com/VadShv/ats-huntfork/commit/95a0b7f5d8f93e3bdcff1428a9414224c84ce923))
* **kudos:** peer recognition + weekly Team Player push (stage G2) ([776a9c7](https://github.com/VadShv/ats-huntfork/commit/776a9c7d88b57a62a3a7e314f0762517685eb4ba))
* **logging:** integrate OpenTelemetry for structured logging to PostHog ([3f62f29](https://github.com/VadShv/ats-huntfork/commit/3f62f29793dffe3eea610c6c738cedd2f95104ed))
* **logging:** refine log attributes type for improved type safety in PostHog API tracking ([38f46b3](https://github.com/VadShv/ats-huntfork/commit/38f46b3711e1fe3a200c86067a2ce2fe685c8ad6))
* **logging:** replace console.error with structured logging for error handling across multiple modules and add Vitest setup for logging stubs ([ded88f8](https://github.com/VadShv/ats-huntfork/commit/ded88f8f683ee3f3038ca1ae4b95ba7d63ae63ad))
* **logging:** replace console.error with structured logging for error handling across various modules ([4451b95](https://github.com/VadShv/ats-huntfork/commit/4451b954f7329ed9dc6bedb76225503551bbafec))
* make candidate email addresses clickable for improved user interaction ([2c01f77](https://github.com/VadShv/ats-huntfork/commit/2c01f77eacf98dc94a196d067cc5395532e0eb98))
* migrate analytics consent management from localStorage to cross-domain cookies ([59e5e33](https://github.com/VadShv/ats-huntfork/commit/59e5e33026451c640acea1ef9b977d617aec6fdd))
* **navbar:** replace static navbar with reusable PublicNavBar component across blog, catalog, docs, and roadmap pages ([a0d17db](https://github.com/VadShv/ats-huntfork/commit/a0d17dbcfe3613d2f5817f54ee9b46758a350ad5))
* **nuxt:** conditionally load PostHog module based on API key availability to prevent crashes ([ddb1f59](https://github.com/VadShv/ats-huntfork/commit/ddb1f599ea56b4d938cb8c50b754fac4561070fd))
* **pipelines:** настраиваемые воронки подбора (Хантфлоу-стиль) ([83a0bfa](https://github.com/VadShv/ats-huntfork/commit/83a0bfa696f00f139c9c11ad7c151172ff7f8a5a))
* **posthog:** add PostHog configuration for server-side event capture ([9958fe5](https://github.com/VadShv/ats-huntfork/commit/9958fe5d37ea75366216bcbd5a2187346c62c938))
* **posthog:** enhance analytics consent management and data minimization in PostHog integration ([92588d9](https://github.com/VadShv/ats-huntfork/commit/92588d9a3a3801eea7e63bae46d773a9e2dc771c))
* **posthog:** enhance PostHog integration with consent handling and graceful shutdown ([5e708fa](https://github.com/VadShv/ats-huntfork/commit/5e708faf1b3808fc24f4a6c51285eb9a4920004b))
* **posthog:** replicate safe accessor for PostHog in composables and plugins to ensure compatibility when not configured ([1e948cb](https://github.com/VadShv/ats-huntfork/commit/1e948cbc2e9543e54756f553327454e70c726702))
* **posthog:** update PostHog integration with environment variables and consent handling ([4b745ec](https://github.com/VadShv/ats-huntfork/commit/4b745ec2f9e768ad11e113799d3b63e17a6cef60))
* **posthog:** update PostHog integration with environment variables and consent handling ([4c11f99](https://github.com/VadShv/ats-huntfork/commit/4c11f99c9bc1331989c80b78bf793dd63ec2584f))
* propagate source tracking parameters through job application flow ([60bdc55](https://github.com/VadShv/ats-huntfork/commit/60bdc55ef55390744aaa8555506cdd741352a323))
* **quests:** daily/weekly quests engine + gamification config layer ([af6c328](https://github.com/VadShv/ats-huntfork/commit/af6c328d102ea6c6e8a8f683472ca31e9927b555))
* **rank:** competitive Rank/Divisions core (stage D1) ([6a0aa15](https://github.com/VadShv/ats-huntfork/commit/6a0aa15d5f502cbba4aa2718ce4d551b1c58300b))
* **rank:** D2 competitive ladder — promo series, decay, placement, weekly tick ([61b2875](https://github.com/VadShv/ats-huntfork/commit/61b2875cd380681abdd2fcc46c65f7c9eb82d123))
* **recruiters:** секция «Рекрутёры» в настройках вакансии + авто-назначение создателя ([3a8bce7](https://github.com/VadShv/ats-huntfork/commit/3a8bce7d1c6f29436350b27461356d22da8bfa9e))
* refactor authentication handling to use runtime-config for providers and remove entrypoint script ([ad91cc9](https://github.com/VadShv/ats-huntfork/commit/ad91cc9ae61ee7d30c95fed4bc52cf09596ada1e))
* refactor demo session checks to use user email for demo account detection ([c747d24](https://github.com/VadShv/ats-huntfork/commit/c747d24f346f6169444abfee2d163ab221fe6cd2))
* refactor demo sign-up flow by removing demo-fresh-signup endpoint and handling session checks in fresh-signup component ([58be8e0](https://github.com/VadShv/ats-huntfork/commit/58be8e0096005c8ffad56937134cc3abbc7126c8))
* refactor demo sign-up flow by replacing POST endpoint with GET for better cookie handling ([e4268eb](https://github.com/VadShv/ats-huntfork/commit/e4268eb346df996379bae987705dada182fe78df))
* refactor interview management with enhanced status transitions and email template integration ([6033d06](https://github.com/VadShv/ats-huntfork/commit/6033d065e7bb1985af78dc12ee2091b96a52ca18))
* refactor timeline component to simplify candidate grouping and remove unused action groups ([8d226c8](https://github.com/VadShv/ats-huntfork/commit/8d226c86819743f46a6b80d615d81c4be6f2c8ea))
* **referrals:** candidate referral / assist system (stage G1, cooperative) ([c5ac7b4](https://github.com/VadShv/ats-huntfork/commit/c5ac7b4d1ecfa5ff4e9a17974593639324da1bd0))
* **resume:** surface parsed resume text in candidate drawer ([f85bbb8](https://github.com/VadShv/ats-huntfork/commit/f85bbb800ae362bc7ff7ccbc4f9aafc5deb72935))
* **resume:** единый вид резюме для всех источников ([5902865](https://github.com/VadShv/ats-huntfork/commit/5902865f4dcf7c64a1d9a247df9b755cdce2dc60))
* **roles:** скоуп рекрутёра, группировка по рекрутёрам, два списка участников и матрица прав (Спринт 20.2) ([b772694](https://github.com/VadShv/ats-huntfork/commit/b772694e71ca7c6103f07584b2eda4237508f930))
* **search:** scope-фильтр FTS по weight-классам tsvector ([d13d205](https://github.com/VadShv/ats-huntfork/commit/d13d205ad6de513bdfe91f3923391b0a8bd16ccb))
* **search:** Sprint 2 — russian config + веса A/B/C/D для search_tsv ([e83df3d](https://github.com/VadShv/ats-huntfork/commit/e83df3d5989dcd1204c9d6c5b8845adcb702b1fd))
* **search:** Sprint 4 — pg_trgm fuzzy fallback по ФИО ([25e3ce1](https://github.com/VadShv/ats-huntfork/commit/25e3ce11a7a6486045e1fd740444a39ef623b129))
* **search:** Sprint 4.5 — дефисные компаунды в FTS ([e24e3c7](https://github.com/VadShv/ats-huntfork/commit/e24e3c741358aad312ac64f13f8679b75920ac6e))
* **search:** Sprint 5 — словарь синонимов для FTS (~150 групп) ([028ad56](https://github.com/VadShv/ats-huntfork/commit/028ad56518eb285f69f28adc69bdbb62ad05af5f))
* **security:** HTTPS на huntfork.ru + Let's Encrypt (Phase 3) ([aa22e49](https://github.com/VadShv/ats-huntfork/commit/aa22e49cdca317408624f1e0de5b4c4cdcff58c5))
* **security:** rate limiting на auth-эндпоинтах (Phase 2) ([a2b66ea](https://github.com/VadShv/ats-huntfork/commit/a2b66ea7c4f0d7f953fc3484242e18c26a44d183))
* **security:** закрытая регистрация + модерация (Phase 1) ([436c12a](https://github.com/VadShv/ats-huntfork/commit/436c12a370c17dc1bb592cc0768df04edee4befa))
* **session-management:** implement session expiration handling and UI feedback for demo accounts ([3a6c1f4](https://github.com/VadShv/ats-huntfork/commit/3a6c1f40922df16520f679d58789e02aaa34e3ab))
* **sidekick:** аудит UI — скролл, растягивание, переполнение текста ([1b9c077](https://github.com/VadShv/ats-huntfork/commit/1b9c077e150c37b422d6830459bd43069e15a952))
* **sidekick:** верификация, карта поиска и карточка интервью на серверном ИИ (П4, П6) ([e728a75](https://github.com/VadShv/ats-huntfork/commit/e728a75f6eb268aeaeb9f3002722795912b6ee4f))
* **sidekick:** пакетная обработка очереди, серверные шаблоны и статистика (П5) ([05412f8](https://github.com/VadShv/ats-huntfork/commit/05412f81ec53e4eae05150fb0cc58af25c6f8cbc))
* **sidekick:** реальный канбан воронки и амбиент на данных ATS (П2, П3) ([0768a90](https://github.com/VadShv/ats-huntfork/commit/0768a9039b5b6933e7fb01999a8434d2235781ad))
* **sidekick:** типизация сообщений и новые хэндлеры background (П1, П7) ([138bd1e](https://github.com/VadShv/ats-huntfork/commit/138bd1e4772b1c4ee793f9431532289d44af6217))
* **sidekick:** честные прототипы за флагом «Экспериментальное» (П0) ([3f6fbd3](https://github.com/VadShv/ats-huntfork/commit/3f6fbd30d82a6a447382537090e5a30dfc51f846))
* **source-tracking:** add tracking links management and attribution ([8d25601](https://github.com/VadShv/ats-huntfork/commit/8d256017c9bed1a279cebaeda93fa5c34be27a29))
* **source-tracking:** enhance tracking links management with dynamic URL generation and sorting functionality ([877d03c](https://github.com/VadShv/ats-huntfork/commit/877d03c1b515864f9204f3b9eeff6a7da53636f2))
* **sourcing:** бейджи "Уже в базе"/"Уже в воронке" для дублей (Sprint 1) ([69fb02c](https://github.com/VadShv/ats-huntfork/commit/69fb02c1a32d0a0096bbee7465374010162e3e53))
* **sourcing:** переработка hh-сорсинга — расширенные снапшоты, лента в расширении ([9aad623](https://github.com/VadShv/ats-huntfork/commit/9aad623287391cd8c667aeb156c9a77b9be25f79))
* **sourcing:** плавное переключение статусов и обязанности в снипетах опыта ([1b32acb](https://github.com/VadShv/ats-huntfork/commit/1b32acbff78b062da934f8bf5028ecdcf253958e))
* streamline authentication configuration by removing deprecated social sign-in options and enhancing OAuth token encryption ([b94ffd9](https://github.com/VadShv/ats-huntfork/commit/b94ffd925fc250c59aa397924a0e4b303406c342))
* **teams:** team leagues + weekly MVP Telegram push (stage E1) ([1076b84](https://github.com/VadShv/ats-huntfork/commit/1076b84335c407d2959b122b8cd7862c9111fa22))
* **timeline:** enhance timeline action styles and status badges ([475e643](https://github.com/VadShv/ats-huntfork/commit/475e6433d665afb2bf364bd418319419685cc62b))
* **timeline:** implement TimelineDateLink component for date navigation and update date displays across applications ([be4a438](https://github.com/VadShv/ats-huntfork/commit/be4a438047c830bf0f2d5ad59973398e231fc818))
* **tracking-links:** implement collision handling for unique tracking code generation and enhance validation for tracking codes ([88489e6](https://github.com/VadShv/ats-huntfork/commit/88489e604485fb35b343ac8f795517eed1e1377e))
* **tracking:** implement privacy-respecting event tracking across various pages and actions ([ebb22c9](https://github.com/VadShv/ats-huntfork/commit/ebb22c91a1d60f86f75a089e25b529ae851a5da8))
* **ui:** unified Org Structure page — companies as tree roots with nested departments ([a54af54](https://github.com/VadShv/ats-huntfork/commit/a54af54338c092557b63462db428e3250e929d6d))
* **ui:** добавлены 6 базовых компонентов и showcase-страница ([a02974e](https://github.com/VadShv/ats-huntfork/commit/a02974e68a229b7d6c5836489f42d375185d2053))
* **ui:** единые бейджи, состояния и композаблы для унификации карточек ([4a52ade](https://github.com/VadShv/ats-huntfork/commit/4a52ade5399ddfcd81dffcd95b6523fdd241e56f))
* **ui:** продуктовые компоненты спринтов 13–18 ([3ee9623](https://github.com/VadShv/ats-huntfork/commit/3ee962396440f89840de23bbb73bb8ee249b47cc))
* **ui:** унифицированная карточка кандидата (Drawer) на странице вакансии ([1a59b88](https://github.com/VadShv/ats-huntfork/commit/1a59b88f60197a81f06e54b3ad6c25684d0653e1))
* **ui:** фундамент UI-системы — токены + UiButton (этап 1-2.1) ([fd90242](https://github.com/VadShv/ats-huntfork/commit/fd90242fbf4d5ca5eb9a78173206826003850611))
* update button labels for clarity and consistency in job creation flow ([850383c](https://github.com/VadShv/ats-huntfork/commit/850383c81066470f665bc3fb323619f8a0c134d4))
* update button styles for social sign-in and sign-up to improve user interaction ([d8d0e6e](https://github.com/VadShv/ats-huntfork/commit/d8d0e6ebbcb6456797051f6baeb6bddaec43f033))
* update code block themes to use github-dark-high-contrast for improved readability ([9689cf0](https://github.com/VadShv/ats-huntfork/commit/9689cf0ae0a9739aacb6ea31fbd2662859a45f0e))
* update color classes for property options to enhance visual consistency ([c827d56](https://github.com/VadShv/ats-huntfork/commit/c827d56f358dc18f0864444dc9ae051629f38d99))
* update Open Graph image and disable exception autocapture in server config ([ad98fae](https://github.com/VadShv/ats-huntfork/commit/ad98faee2ee4678e8fbfc852add91e26c5184c15))
* Update PostHog consent model to use sessionStorage for cookieless tracking ([1368dbb](https://github.com/VadShv/ats-huntfork/commit/1368dbb4da7efa58ed18eb041fff605565d7da7d))
* update scoring criteria steps in candidate application, job creation, and resume upload tests ([30d87f0](https://github.com/VadShv/ats-huntfork/commit/30d87f07583d4eba9dbf3db35a0e604425ebcfb9))
* **updates:** add API endpoints for update management, backup, chang… ([e8432e5](https://github.com/VadShv/ats-huntfork/commit/e8432e52cde8c035a704d26b2b7bd79523b3ce2e))
* **updates:** add API endpoints for update management, backup, changelog, system info, and version check ([3a5d96e](https://github.com/VadShv/ats-huntfork/commit/3a5d96e8e5c453974a3d17a5b470b924f656aaf5))
* **updates:** enhance backup functionality and improve update checks with error handling ([1921be8](https://github.com/VadShv/ats-huntfork/commit/1921be8c883085b4590497cda2157f39959b31e6))
* **ux:** полировка интерфейса (Этап 6) ([fa8bc01](https://github.com/VadShv/ats-huntfork/commit/fa8bc01500d9f71789a8e562619d9ba3ea9ebd60))
* **воронка:** UI — StagePicker с подэтапами, guard-диалоги QuickActions, таймлайн, bulk и фильтры по этапам ([6b413c3](https://github.com/VadShv/ats-huntfork/commit/6b413c3e60e553bd0ea2f9f9d9a2f480c534c6b8))
* **воронка:** Спринт 22 этап 3 — hh-рассинхрон с ре-синком, перевод на другую вакансию (миграция 0064), причины отказа и шаблоны сообщений в настройках воронки (миграция 0065) ([f4af5ab](https://github.com/VadShv/ats-huntfork/commit/f4af5abe45add09797339c1ba1f95c733b060ca0))
* **воронка:** Спринт 22 этапы 1–2 — единый moveApplicationStage, guards G1/G3, родитель «Отказ» с подэтапами, нормализация legacy-статусов (миграции 0062–0063) ([38f254c](https://github.com/VadShv/ats-huntfork/commit/38f254c9de0a06d714de440cc88e98f921c012e7))


### 🐛 Bug Fixes

* **achievements:** gen_random_uuid() for catalog insert + use user.name in leaderboard ([6e898ff](https://github.com/VadShv/ats-huntfork/commit/6e898ff78e6e3452edbb188f63a5d75f8cb319af))
* **achievements:** map snake_case catalog metrics to camelCase RecruiterMetrics ([d26b29f](https://github.com/VadShv/ats-huntfork/commit/d26b29f7e7372f1bdf4a2ce0411f42e0b5ffdce0))
* **achievements:** rewrite metrics with db.select() for Proxy compatibility ([9f650f8](https://github.com/VadShv/ats-huntfork/commit/9f650f8c2e8fb35db201dc5fd2d749ea354d321d))
* **achievements:** timezone-aware special metrics, shared db pool, seed-once, debounce ([79ae075](https://github.com/VadShv/ats-huntfork/commit/79ae075708098743568e071e0965447ce59c37ec))
* **achievements:** use correct activity_log format for vacancies_closed ([7dbbbc9](https://github.com/VadShv/ats-huntfork/commit/7dbbbc9e413d325a9a5b42c3529e525371406bf9))
* **achievements:** use direct postgres client to bypass drizzle Proxy ([196ba32](https://github.com/VadShv/ats-huntfork/commit/196ba321c6c0e0aaa60770d35e51b087c133c8a0))
* **achievements:** use drizzle column refs in fastest_hire query (no raw aliases) ([1b8dd12](https://github.com/VadShv/ats-huntfork/commit/1b8dd12ff7847fd641186014c7552de9f75e4d0c))
* add config and manifest file parameters to release-please action ([ff30b11](https://github.com/VadShv/ats-huntfork/commit/ff30b11bbcaea0d7ab92be887e008edc656ba5cc))
* Add cover letter validation and error handling in application forms ([41ed76f](https://github.com/VadShv/ats-huntfork/commit/41ed76fb2412d2d82a6e2c38a46495b7ed747a33))
* add ownership to copied files in Dockerfile for proper permissions ([7715ca6](https://github.com/VadShv/ats-huntfork/commit/7715ca694bab54e055f5edd87f6f0979cc67a0ad))
* address CodeRabbit review comments on PR [#166](https://github.com/VadShv/ats-huntfork/issues/166) ([3b9e52b](https://github.com/VadShv/ats-huntfork/commit/3b9e52bd33c597346b6defeb0ab1d4c068b03feb))
* **ai:** fallback mapper for non-schema responses + 90s timeout ([5789ea6](https://github.com/VadShv/ats-huntfork/commit/5789ea68c77d16a13e713508fedd8fd2d11fcc1e))
* **ai:** устойчивая схема критериев и скоринга — дефолты для полей, которые модель опускает ([aece652](https://github.com/VadShv/ats-huntfork/commit/aece65262e2fdf7c348031ac67494885e9b0f625))
* **brand:** runtime title/favicon override через useHead ([aef8c71](https://github.com/VadShv/ats-huntfork/commit/aef8c715fcbebfc4d1843d2c67f814aea687fa6d))
* **brand:** Сокол не загружался — ассеты в неверной папке ([3279791](https://github.com/VadShv/ats-huntfork/commit/3279791cfa65581654efbe2130a4af2bef38140b))
* **candidate:** resume structuring reliability — dedup, determinism, no data loss ([2e2750a](https://github.com/VadShv/ats-huntfork/commit/2e2750a7222e124e3f0d1001675ca884f7e7b9b6))
* **candidates:** \u043f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0435\u043c \u0432\u0441\u0435 \u043e\u0442\u043a\u043b\u0438\u043a\u0438 (\u0431\u044b\u043b\u043e \u043e\u0431\u0440\u0435\u0437\u0430\u043d\u0438\u0435 \u0434\u043e 100) ([a85cd43](https://github.com/VadShv/ats-huntfork/commit/a85cd43f4b19c5d6c0aeaf8de36f720704b32c22))
* cast return type of getAuth function to Auth ([665e059](https://github.com/VadShv/ats-huntfork/commit/665e05932061f83c1c3b73aa729a54a3ef571ffb))
* **chatbot:** search_candidates — убираем зацикливание модели на пустых вызовах ([f6764ce](https://github.com/VadShv/ats-huntfork/commit/f6764ce61be097eb684dac61da3eabf496b2353e))
* **chatbot:** server-side извлечение query для слабых моделей (Qwen) ([dfc6ecf](https://github.com/VadShv/ats-huntfork/commit/dfc6ecf7dfa77067fbeb96f7ba1d1c23b42c65bd))
* **chatbot:** tool-calls для Yandex Qwen3 — coerce empty arguments→{} ([d4fc170](https://github.com/VadShv/ats-huntfork/commit/d4fc170301d3d508e2681fc768e1666d76ff8f77))
* **chatbot:** диагностика + ILIKE-fallback для search_candidates ([d1deaab](https://github.com/VadShv/ats-huntfork/commit/d1deaab3a7c5e34646e102d2f8b8dd5dca40246d))
* **chatbot:** минимизируем payload search_candidates для Qwen ([c1dbe21](https://github.com/VadShv/ats-huntfork/commit/c1dbe219291bea4f95d3ae558c8806e3daace229))
* **collab-thread:** тред в воронке вакансии + мгновенное появление комментария ([6dde132](https://github.com/VadShv/ats-huntfork/commit/6dde132938b0acb77e27e760dc22365039b3701b))
* **comms:** пустой черновик у reasoning-моделей Qwen ([7779f5c](https://github.com/VadShv/ats-huntfork/commit/7779f5c29096d0cff3711b61d0cb696476a80e75))
* correct promise chaining for Google Calendar event creation ([a935615](https://github.com/VadShv/ats-huntfork/commit/a935615e2eae720111672fa34d135163f31f4121))
* correct syntax error in prefetchOidcEndpointOrigins function ([3f6a56b](https://github.com/VadShv/ats-huntfork/commit/3f6a56bb21f3ca5648f1f8874c1579b07748bc7a))
* **dedup:** модалка вместо ошибки при создании exact-дубля ([508eeff](https://github.com/VadShv/ats-huntfork/commit/508eeff87cac8e18f65a49b029bf43fc3d4c6367))
* enhance file upload validation for resumes and add E2E tests for all formats ([c8dc28f](https://github.com/VadShv/ats-huntfork/commit/c8dc28f4b346ae5bc3815a7ce26c55a8459c68bd))
* enhance rate limiting logic and add tests ([6fe4900](https://github.com/VadShv/ats-huntfork/commit/6fe490000487779ad008277ee650ded375bdbcf9))
* ensure active organization is set explicitly and update navigation logic ([b0160b1](https://github.com/VadShv/ats-huntfork/commit/b0160b1117a2f3686bee2cf4766bdb5f89f1cb63))
* ensure allure report directory is created before generation ([ae933a0](https://github.com/VadShv/ats-huntfork/commit/ae933a0cb5f8e269f90394569b77ad7132537ee8))
* **extension:** корректный путь импорта db (utils/db, не database/client) ([e0655f1](https://github.com/VadShv/ats-huntfork/commit/e0655f1c208a5a63441c524337f698d09ad20e79))
* Fixes the public application form to show file upload and cover letter, additionally imrpove the multi step form to simplify the process ([f3163b0](https://github.com/VadShv/ats-huntfork/commit/f3163b08f127907da30f569b6606e64915135ddb))
* **gamification:** lazy guarded catalog seeding — close plugin-before-migration race ([1432444](https://github.com/VadShv/ats-huntfork/commit/14324449e36a9ad4c27b59acf145a986a88323a2))
* **hh-sourcing:** индикатор фазы, просмотр/редактирование запроса, лимит кандидатов и фикс импорта ([f73d0c6](https://github.com/VadShv/ats-huntfork/commit/f73d0c6dc2863c27ed66eac8d35d34e158f53fa9))
* hh.ru actions.get_with_contact (без s) — кнопка реально раскрывает контакты ([1f0ddfa](https://github.com/VadShv/ats-huntfork/commit/1f0ddfa4a3796818e514cb3cc56212dd2e8a6fca))
* **hh:** \u0445\u043e\u0434\u0438\u043c \u043f\u043e \u043a\u043e\u043b\u043b\u0435\u043a\u0446\u0438\u044f\u043c \u0440\u0430\u0431\u043e\u0442\u043e\u0434\u0430\u0442\u0435\u043b\u044f + \u0432\u0438\u0434\u0438\u043c\u0430\u044f \u0441\u0432\u044f\u0437\u043a\u0430 \u0432 UI ([ea915b5](https://github.com/VadShv/ats-huntfork/commit/ea915b5176509fa8c9e99b6d9b9aba875a0b0a88))
* **hh:** счётчик imported_count считаем как COUNT(*) из hh_negotiation ([27abfb2](https://github.com/VadShv/ats-huntfork/commit/27abfb243d5ee8c5032c2e59b0c47e1bfc1b01e7))
* **hm:** корректный сдвиг stage при reject + резюме hh.ru для НМ + видимость плашки добавления НМ ([050a79b](https://github.com/VadShv/ats-huntfork/commit/050a79bbdb8a1094632b4e1e4468494b78b372e3))
* **hm:** миграция 0061 для check constraint invite_link.role + панель добавления НМ не исчезает ([d841e92](https://github.com/VadShv/ats-huntfork/commit/d841e92d6ddaf9601c452d5f8123d1e34b01b636))
* **hm:** назначение НМ на вакансию доступно рекрутёру (role=member) ([4b83902](https://github.com/VadShv/ats-huntfork/commit/4b839024aee80aabf70b3a1edc5233a5759eeb2c))
* **hm:** секция НМ падала при рендере назначенных — API отдаёт плоские userName/userEmail ([a5c0ae4](https://github.com/VadShv/ats-huntfork/commit/a5c0ae4903f9f221db3b61a134e9e670ece8648d))
* **hm:** форма добавления НМ остаётся видимой после назначения ([d2ae33e](https://github.com/VadShv/ats-huntfork/commit/d2ae33ef94a277ebda6863cd6d242fa20edea414))
* **i18n:** экранировать @ в comments.composer_placeholder ([3435519](https://github.com/VadShv/ats-huntfork/commit/343551952ea7baf7a36d454007761ea04157e6fc))
* improve application link validation and enhance cover letter requirement handling in tests ([0297943](https://github.com/VadShv/ats-huntfork/commit/029794323058fa65457a511ca30310a1790940b6))
* **issue-template:** enable blank issues in configuration ([b634752](https://github.com/VadShv/ats-huntfork/commit/b6347524088d46401b7ff48776666d839c0ee509))
* **jobs:** \u043f\u043e\u0434\u043d\u044f\u043b\u0438 \u0434\u0435\u0444\u043e\u043b\u0442\u043d\u044b\u0439 \u043b\u0438\u043c\u0438\u0442 \u0434\u043e 500 \u0438 \u0432 pipeline-\u0432\u044c\u044e ([52592ba](https://github.com/VadShv/ats-huntfork/commit/52592ba977e83cd38875786c7a63485642b9cacf))
* **jobs:** корректный i18n-ключ для кнопки создания вакансии ([a631a31](https://github.com/VadShv/ats-huntfork/commit/a631a311a388ff76e52c16bd0024b77a3e829ad2))
* **jobs:** убираем ложные '429 → Не удалось загрузить отклики' ([bd2bac5](https://github.com/VadShv/ats-huntfork/commit/bd2bac572706943a0e34e484133f8dc9ccb51642))
* **migrations:** apply each statement with autocommit instead of one transaction ([417918a](https://github.com/VadShv/ats-huntfork/commit/417918ab0db3f9df416584c5d08e3e4fbd29fce0))
* **migrations:** inline migration reader to avoid Rollup build breakage ([d24fd77](https://github.com/VadShv/ats-huntfork/commit/d24fd774a8fb7dc0b44981748a34ed59d20fa240))
* **migrations:** добавить 0038/0039 в _journal.json — иначе drizzle их пропускает ([aea1014](https://github.com/VadShv/ats-huntfork/commit/aea1014023c29b12f1051c7eb88260b979fbdf5a))
* **migrations:** корректный timestamp для 0037 (drizzle сравнивает по when, был меньше предыдущих) ([b80c317](https://github.com/VadShv/ats-huntfork/commit/b80c31700f9296929d3aead616f6e016f3747d8f))
* **migrations:** корректный when для 0059/0060 ([3147e09](https://github.com/VadShv/ats-huntfork/commit/3147e093f4ddd8fe86ba8e7e95d45fd9ab0c37e4))
* **open-hh-contacts:** распознавать обе конвенции placeholder-данных ([2005c73](https://github.com/VadShv/ats-huntfork/commit/2005c73581aad2843c150f4d3ee864dc9964ec25))
* **parser:** PDF worker resolution для Nitro-сборки ([66a597c](https://github.com/VadShv/ats-huntfork/commit/66a597ce23770d1a5c1b22a894355d435ba89163))
* **posthog:** read server PostHog config from env vars directly ([74ae687](https://github.com/VadShv/ats-huntfork/commit/74ae6874e2019944bf8d71f314fb2dfc988b7658))
* **posthog:** update proxy targets for PostHog integration with environment variable notes ([da4e78d](https://github.com/VadShv/ats-huntfork/commit/da4e78dc6552b14201432429229a10363eaf5748))
* **properties:** cast needles массива в ARRAY[]::text[] для оператора `in` ([d5bc53e](https://github.com/VadShv/ats-huntfork/commit/d5bc53e096922150634800bb03e370f240415df1))
* register migrations 0023 and 0024 in drizzle journal ([93ed4b1](https://github.com/VadShv/ats-huntfork/commit/93ed4b1cd341e3f8cb7d541fd7dd595241dd618b))
* **release:** remove pull request header from release configuration ([9636fd5](https://github.com/VadShv/ats-huntfork/commit/9636fd5581032283af5c89b8be654ea01ae5fa6f))
* remove invalid highlight option from nuxt content config ([4db9435](https://github.com/VadShv/ats-huntfork/commit/4db94356c32ad23c873f7f34b74ea3be83303ca2))
* remove orphaned code after &lt;/template&gt; in candidates/new.vue ([a976d8d](https://github.com/VadShv/ats-huntfork/commit/a976d8d45292e051d9a51a48fd348024ef56c9ca))
* remove stray character causing build failure in provider.ts ([678b455](https://github.com/VadShv/ats-huntfork/commit/678b455ad0d3a80a793d4f793a634d1223272f49))
* resolve esbuild and typecheck errors in PR validation ([e3d9994](https://github.com/VadShv/ats-huntfork/commit/e3d9994ecc05cc03d4086443e97497e76156bc50))
* resolve typecheck and E2E CI failures ([693308a](https://github.com/VadShv/ats-huntfork/commit/693308af32fd6a4caa83500e02157f1366e0ffed))
* **resume-parser:** layout-aware PDF text extraction (columns/lines) + word-hyphen repair ([7721847](https://github.com/VadShv/ats-huntfork/commit/7721847dbe8aae29589011bc8aa1b1184e524684))
* **resume:** increase AI timeout to 180s + improve name extraction heuristic ([d60b672](https://github.com/VadShv/ats-huntfork/commit/d60b672c86aee88dce86b7a1af2f04405aa42a66))
* **resume:** revert layout getText params + drop costly retry (regression fix) ([d17526d](https://github.com/VadShv/ats-huntfork/commit/d17526dbd6b8b1b909a183f0c02df53a898d8b34))
* Rewrite Host headers in proxyRequest to prevent Cloudflare errors ([fee0be6](https://github.com/VadShv/ats-huntfork/commit/fee0be64df209fee9cddc1844863a395460b3c31))
* **sidekick:** фиксы по ревью — воспроизводимая сборка, mock за флагом, изоляция батчей ([97565b6](https://github.com/VadShv/ats-huntfork/commit/97565b6d5c615968fac67aae342d4f79acea7871))
* **sourcing:** фиксы по ревью перед слиянием в main ([97ecc4c](https://github.com/VadShv/ats-huntfork/commit/97ecc4cde5d9acd50cd40f40ede33955f11c3e62))
* **sync:** единая точка записи статусов — внедрения аудита синхронизации ([873a5f4](https://github.com/VadShv/ats-huntfork/commit/873a5f4d49bf80783a20e95a79fc0e2d3127af8d))
* **ui:** не съезжает текст в списке откликов кандидата — бейдж источника переехал к названию вакансии ([5d0d054](https://github.com/VadShv/ats-huntfork/commit/5d0d054bacafa281a7ce971369f976e8c5d848a2))
* update comments for clarity and enhance rate limiting logic in production ([921ea39](https://github.com/VadShv/ats-huntfork/commit/921ea399bc35fbb006274d98faf7433fedf88aa5))
* update Dockerfile comments for clarity on output structure ([bb12785](https://github.com/VadShv/ats-huntfork/commit/bb12785002beb6df252c89129b9f103c3b1e6db9))
* update G2 ranking link for Greenhouse in ATS comparison article ([c46549e](https://github.com/VadShv/ats-huntfork/commit/c46549ec9e258a85d8e9c3bd63cbea549f0ec630))
* update invitation links to use object syntax for localePath ([e9d8534](https://github.com/VadShv/ats-huntfork/commit/e9d85344047723704e29ee2df9a8b52fe389ff25))
* update MinIO setup in E2E tests to use Docker run command and improve health checks ([0a26655](https://github.com/VadShv/ats-huntfork/commit/0a266551be70e995856e9457a2e5279f575ec2ba))
* update newLinkMaxUses type to accept both string and number ([d5ab8c1](https://github.com/VadShv/ats-huntfork/commit/d5ab8c1f9edfc9ca9b3cac09700308355a9b2aff))
* update newLinkMaxUses type to accept both string and number ([300870a](https://github.com/VadShv/ats-huntfork/commit/300870aa523052d073f252756fc37e220b6a5712))
* update overrides to resolve high-severity CVEs blocking dep PRs ([a1edd32](https://github.com/VadShv/ats-huntfork/commit/a1edd32486b91edc60dec80e95d74b8c6d24b877))
* update token in release-please action for proper authentication ([5ae917e](https://github.com/VadShv/ats-huntfork/commit/5ae917e3c30cd5e819a1be97045e4890d4ac0f7b))
* update token reference in release-please workflow to prioritize RELEASE_PLEASE_TOKEN ([7a57891](https://github.com/VadShv/ats-huntfork/commit/7a57891bcfae98080e9268a2d38bce5dec29c71d))
* update token reference in release-please workflow to use GITHUB_TOKEN ([b2733f8](https://github.com/VadShv/ats-huntfork/commit/b2733f89c69f3dfff1005368f8a15d6e49081ecd))
* аналитика — период как ISO-строки вместо Date в raw-SQL ([68152d7](https://github.com/VadShv/ats-huntfork/commit/68152d7991c7e0e5a1a1bad320a1c4d469429a3a))
* вывод ошибки рефреша mv аналитики в консоль (виден в docker logs) ([4f8655f](https://github.com/VadShv/ats-huntfork/commit/4f8655f08848845deab71b00095fdbc2dcbe633e))


### ⚡ Performance

* **dedup:** фундамент скорости — pg-boss очередь, кеш орг-группы, индексы (Sprint 1) ([cd86b5b](https://github.com/VadShv/ats-huntfork/commit/cd86b5b1e9b719ba708592bc5da131a7da214531))


### 📝 Documentation

* ADR — секции описания вакансии как надстройка над каноническим description ([a488410](https://github.com/VadShv/ats-huntfork/commit/a4884102cfde09537d22599e1c01d2495acd46ab))
* **candidate:** master-profile + resume versioning design plan (living-doc) ([8b0010a](https://github.com/VadShv/ats-huntfork/commit/8b0010ae18ca144ace934162b0272e674dbdcf24))
* **candidate:** record implemented fixes + tech debt (UI parity, PDF parsing, external parser options) ([427f8ff](https://github.com/VadShv/ats-huntfork/commit/427f8ffc0bad3a34e59df2611d9aa2ad2b6e2dc8))
* **dedup:** бэклог пост-MVP по дедупликации и смежным доработкам ([b03260e](https://github.com/VadShv/ats-huntfork/commit/b03260ec149ec51ef33128e5441fdbe1472ca93a))
* gamification living-doc — philosophy, achievements module, HuntPass + quests design ([e49e70a](https://github.com/VadShv/ats-huntfork/commit/e49e70ab840406d2d5d67179aba6f26dd66f46c3))
* **gamification:** fix living-doc — add implemented D–G3 mechanics (rank, teams, duels, economy, referrals, kudos, league hub, metrics table, primary recruiter) ([eb53268](https://github.com/VadShv/ats-huntfork/commit/eb5326873660725cc0f4dca410d065ae1d5f64f8))
* **sidekick:** фиксация доработок живого стриминга ИИ — итоговый документ, ТЗ и QA-скрипт ([42c270e](https://github.com/VadShv/ats-huntfork/commit/42c270e3ba46614425978e02943bc96d6d658fdb))
* идея распределения по этапам hh при привязке + ТЗ публикации вакансий на hh.ru ([3650416](https://github.com/VadShv/ats-huntfork/commit/36504162237d267ab76b733c3b22c8e9e737b8c0))
* канонический документ воронки + ADR о сохранении application.status ([75b1fcf](https://github.com/VadShv/ats-huntfork/commit/75b1fcf7bf35bb8d9be677cff4e25fa1c448bf07))
* ролевая модель и права доступа v1 + план UI-настройки прав ([db2e4d6](https://github.com/VadShv/ats-huntfork/commit/db2e4d6240ee4a8910c979658ce90ff013aec58c))
* ТЗ — подэтап «На рассмотрении» и очередь НМ в «Все неразобранные» ([0d0e8b6](https://github.com/VadShv/ats-huntfork/commit/0d0e8b6b334dbd3c79773975ff699a5c94cb8623))
* ТЗ Спринт 21 (RBAC/аналитика) и Спринт 22 (Воронка 2.0) ([35237d1](https://github.com/VadShv/ats-huntfork/commit/35237d17ecfdc3cf83c1f3358ef251b56d30b4aa))
* ТЗ Спринты 23–25 — быстрые действия 2.0 и аналитика (решения O1–O3, блок B отложен) ([0ae79bf](https://github.com/VadShv/ats-huntfork/commit/0ae79bf95650e809797a250244b05cedef83ddb2))


### ♻️ Refactoring

* **candidate:** unify resume block into CandidateResumePanel (drawer ↔ full page parity) ([4073eb6](https://github.com/VadShv/ats-huntfork/commit/4073eb648b18bf5257f2ecdece9edeaad55d1ad1))
* **jobs:** миграция /dashboard/jobs на Ui*-компоненты ([6512fe4](https://github.com/VadShv/ats-huntfork/commit/6512fe46ea04e3cbf19dc4c162b90ab55ab8c194))
* **sidekick:** декор в fx/, ленивые разделы, чинка emits (П7) ([5bee6bf](https://github.com/VadShv/ats-huntfork/commit/5bee6bf3eb468fa67e8e652617f215734bc0ef1d))
* simplify refreshNuxtData calls in useInterview composable and remove unused migration placeholder ([b9533fe](https://github.com/VadShv/ats-huntfork/commit/b9533fece569f9c2d4f1ae75960f28f17a115f29))
* **ui:** единый визуальный язык действий в карточке кандидата ([b1234e4](https://github.com/VadShv/ats-huntfork/commit/b1234e4434a98e073c00064366d76b16a0139243))
* **ui:** карточка отклика на странице кандидата — вертикальная компоновка ([d76ff3b](https://github.com/VadShv/ats-huntfork/commit/d76ff3b450e8aa1ea57af190156e4d4487488a3c))
* **ui:** применение единого стандарта во всех карточках, drawer и списках ([5ea703d](https://github.com/VadShv/ats-huntfork/commit/5ea703d6f938f16ae46bf779aae60c8a39e5737d))
* update layout and styling for settings pages ([2cb9723](https://github.com/VadShv/ats-huntfork/commit/2cb97235c7f4a0282268edddbc2983d134f020a9))
* update status and transition classes for improved UI consistency ([597f069](https://github.com/VadShv/ats-huntfork/commit/597f069962e0b0677d04f555dd9a6c74bdeaa6ce))


### 🧪 Testing

* add security tests for recent fixes ([6fe4900](https://github.com/VadShv/ats-huntfork/commit/6fe490000487779ad008277ee650ded375bdbcf9))
* add unit tests for pgDumpEnv utility ([6fe4900](https://github.com/VadShv/ats-huntfork/commit/6fe490000487779ad008277ee650ded375bdbcf9))


### 🏗️ Build & CI

* успешный ([9bfb883](https://github.com/VadShv/ats-huntfork/commit/9bfb88357b54a81d80fa034f50b2b6f6bbc77c0b))

## [1.4.0](https://github.com/reqcore-inc/reqcore/compare/v1.3.0...v1.4.0) (2026-04-30)


### ✨ Features

* add AI chatbot feature with configuration, access control, and attachment management ([e139b72](https://github.com/reqcore-inc/reqcore/commit/e139b7296c1f3b0275ade32f5f44bac373559bf3))
* add AI chatbot feature with configuration, access control, and attachment management ([912d55d](https://github.com/reqcore-inc/reqcore/commit/912d55d864efee44bf6f17c18c4dff77dfd0a86a))
* add ApplicationDetailDrawer and CandidateDetailDrawer components ([1371e7d](https://github.com/reqcore-inc/reqcore/commit/1371e7ddfdefb09d152b3945951c5abbce068602))
* add column visibility management to Applications and Candidates views ([a5237a5](https://github.com/reqcore-inc/reqcore/commit/a5237a54448cc5f6de88e2509d44ee3701e96975))
* add docker entrypoint script to derive NUXT_PUBLIC_* flags from environment variables ([39e098e](https://github.com/reqcore-inc/reqcore/commit/39e098ece0e8823513be402a8d68636bd3ebea3d))
* add Docker support with pre-built image instructions and CI workflow ([753b37e](https://github.com/reqcore-inc/reqcore/commit/753b37ea15eeb3c8ccbe6249d634d736574da13a))
* add Docker support with pre-built image instructions and CI workflow ([6f9223d](https://github.com/reqcore-inc/reqcore/commit/6f9223d520baa5dada4379cd175c78738837d290))
* add document re-parsing functionality and improve error handling in candidate analysis ([8842c6f](https://github.com/reqcore-inc/reqcore/commit/8842c6fb69b78b3f07326bba98c14032ff7a02e6))
* add experience level and quick notes fields to job and candidate schemas ([d36b5a0](https://github.com/reqcore-inc/reqcore/commit/d36b5a07ae2aecb0ffc3faa52eabf5219f8da468))
* add new migration entries for candidate demographics organization settings and salary negotiable ([36e3e81](https://github.com/reqcore-inc/reqcore/commit/36e3e8171fc367c89afe17c38522e0ea447e0911))
* add Nitro plugin to recompute public auth-provider flags at server startup ([6b7b699](https://github.com/reqcore-inc/reqcore/commit/6b7b6999a6c12f21009f8bd9b474412fdf86c9fc))
* add OIDC SSO environment validation and unit tests ([1b23af3](https://github.com/reqcore-inc/reqcore/commit/1b23af31b04d150e277701401e29424a07f9b8a8))
* add organization localization settings and candidate demographics ([f828877](https://github.com/reqcore-inc/reqcore/commit/f828877ff1090cc9001ede9e5be3cfdfa26cec7f))
* add property management utilities and schemas ([a62eea1](https://github.com/reqcore-inc/reqcore/commit/a62eea1f5644ba0cd4cd892cea14a376746994ce))
* add property management utilities and schemas ([4dc5aad](https://github.com/reqcore-inc/reqcore/commit/4dc5aad0252a67306633b9f63e56d9d5737bce7d))
* add raw tag support for Docker image publishing ([29775cb](https://github.com/reqcore-inc/reqcore/commit/29775cb1b17d560f76bfe2e73e5d5dc2c5d99a9c))
* add salary input change handlers and update permissions for organization ([6c238c2](https://github.com/reqcore-inc/reqcore/commit/6c238c2fae2341639bde2f961ba1bbd36708044f))
* add site origin computation for dynamic redirect URI in SSO setup ([9e5aa68](https://github.com/reqcore-inc/reqcore/commit/9e5aa688006e9254bc44f4c93c180c300ed9ad12))
* add SSO provider schema and relations for better authentication integration ([62fdf39](https://github.com/reqcore-inc/reqcore/commit/62fdf399d79132e30889ded51b312642454de2f9))
* **ai-config:** add connection test functionality and update AI settings UI ([c9f4afd](https://github.com/reqcore-inc/reqcore/commit/c9f4afd15b8787ce4c9414db2bde7a21ed3ffc10))
* enhance authentication security with stricter password policy, email verification, and session management ([aaae17f](https://github.com/reqcore-inc/reqcore/commit/aaae17f66c6ee3f669843526c38d9f38983aa662))
* enhance forgot password functionality and improve SSRF protection ([8e0abd6](https://github.com/reqcore-inc/reqcore/commit/8e0abd6efcc1b1ad8bceacd32491d46909fea46c))
* enhance OIDC endpoint origin fetching to directly inject discovered origins into trusted-origins list ([ee34d86](https://github.com/reqcore-inc/reqcore/commit/ee34d86125e3de07b2ca0e200c52f94c4d8f87a2))
* Enhance PostHog proxy handling with explicit header management and error handling ([8b9ea20](https://github.com/reqcore-inc/reqcore/commit/8b9ea205c32b86e43268d2ffb26cc6972a9855cb))
* enhance property management with new color variables and update component interactions ([349ec6a](https://github.com/reqcore-inc/reqcore/commit/349ec6a76f2bec70a0b1410e1c8fdd990fa28600))
* enhance PropertyFilterBar and PropertySchemaEditor with improved element references and state management ([cd7524e](https://github.com/reqcore-inc/reqcore/commit/cd7524e4b7d716dc4c732ee88ca60d4c66c91c7e))
* enhance SSO sign-in and sign-up error handling, and enforce email requirement in profile mapping ([76c54b4](https://github.com/reqcore-inc/reqcore/commit/76c54b4026eb3de9e5aa6de57eaf682393f24a27))
* enhance trusted origins resolution for CSRF checks and OIDC discovery ([3c24417](https://github.com/reqcore-inc/reqcore/commit/3c244175cd07e428624217a6d609bd5d3ae155a5))
* enhance trusted origins resolution for SSO provider registration ([b5832b6](https://github.com/reqcore-inc/reqcore/commit/b5832b64c975c9dab88ba2a3b84208758bb1fbc9))
* enhance workflows and documentation for release process, including PR title linting and release verification ([4785db5](https://github.com/reqcore-inc/reqcore/commit/4785db56bd7d282ce28f63a18f3687c976c525e0))
* implement forgot password and reset password functionality ([aa00e89](https://github.com/reqcore-inc/reqcore/commit/aa00e8947d5c0b37410971624d3e036504ca8ceb))
* implement forgot password and reset password functionality ([ad864ef](https://github.com/reqcore-inc/reqcore/commit/ad864efff2456ad08aa7038d7f1e9a312263d9a9))
* implement OIDC endpoint origin prefetching for trusted origins resolution ([9c355ab](https://github.com/reqcore-inc/reqcore/commit/9c355abc6720fe129255107462472fada48ba76e))
* implement social sign-in for Google, GitHub, and Microsoft with configuration support ([d4ceaf8](https://github.com/reqcore-inc/reqcore/commit/d4ceaf811134d881af5fe74d70db78d85717f802))
* implement social sign-in for Google, GitHub, and Microsoft with configuration support ([0e4d4bd](https://github.com/reqcore-inc/reqcore/commit/0e4d4bd686c9c7014a149289f2e87b2c359c395d))
* Implement two-tier consent model for PostHog analytics ([0d51cd5](https://github.com/reqcore-inc/reqcore/commit/0d51cd53dbae1c20267a04220f2b6bd42e3ae2c9))
* Implement two-tier consent model for PostHog analytics ([ef7fee5](https://github.com/reqcore-inc/reqcore/commit/ef7fee50cfa5cf0fa079f264453cdba873fa97df))
* implement unique default chatbot agent constraint and enhance related logic for attachment management ([f11a78f](https://github.com/reqcore-inc/reqcore/commit/f11a78fced7dcc82e1a98bce28b94f2010bfe705))
* improve edit element reference handling in PropertyFilterBar ([486d0e1](https://github.com/reqcore-inc/reqcore/commit/486d0e148b7a10ba36d59931c776a26ea6b1ee77))
* refactor authentication handling to use runtime-config for providers and remove entrypoint script ([ad91cc9](https://github.com/reqcore-inc/reqcore/commit/ad91cc9ae61ee7d30c95fed4bc52cf09596ada1e))
* streamline authentication configuration by removing deprecated social sign-in options and enhancing OAuth token encryption ([b94ffd9](https://github.com/reqcore-inc/reqcore/commit/b94ffd925fc250c59aa397924a0e4b303406c342))
* update button styles for social sign-in and sign-up to improve user interaction ([d8d0e6e](https://github.com/reqcore-inc/reqcore/commit/d8d0e6ebbcb6456797051f6baeb6bddaec43f033))
* update color classes for property options to enhance visual consistency ([c827d56](https://github.com/reqcore-inc/reqcore/commit/c827d56f358dc18f0864444dc9ae051629f38d99))
* Update PostHog consent model to use sessionStorage for cookieless tracking ([1368dbb](https://github.com/reqcore-inc/reqcore/commit/1368dbb4da7efa58ed18eb041fff605565d7da7d))


### 🐛 Bug Fixes

* address CodeRabbit review comments on PR [#166](https://github.com/reqcore-inc/reqcore/issues/166) ([3b9e52b](https://github.com/reqcore-inc/reqcore/commit/3b9e52bd33c597346b6defeb0ab1d4c068b03feb))
* correct syntax error in prefetchOidcEndpointOrigins function ([3f6a56b](https://github.com/reqcore-inc/reqcore/commit/3f6a56bb21f3ca5648f1f8874c1579b07748bc7a))
* register migrations 0023 and 0024 in drizzle journal ([93ed4b1](https://github.com/reqcore-inc/reqcore/commit/93ed4b1cd341e3f8cb7d541fd7dd595241dd618b))
* remove orphaned code after &lt;/template&gt; in candidates/new.vue ([a976d8d](https://github.com/reqcore-inc/reqcore/commit/a976d8d45292e051d9a51a48fd348024ef56c9ca))
* resolve esbuild and typecheck errors in PR validation ([e3d9994](https://github.com/reqcore-inc/reqcore/commit/e3d9994ecc05cc03d4086443e97497e76156bc50))
* Rewrite Host headers in proxyRequest to prevent Cloudflare errors ([fee0be6](https://github.com/reqcore-inc/reqcore/commit/fee0be64df209fee9cddc1844863a395460b3c31))
* update token reference in release-please workflow to prioritize RELEASE_PLEASE_TOKEN ([7a57891](https://github.com/reqcore-inc/reqcore/commit/7a57891bcfae98080e9268a2d38bce5dec29c71d))
* update token reference in release-please workflow to use GITHUB_TOKEN ([b2733f8](https://github.com/reqcore-inc/reqcore/commit/b2733f89c69f3dfff1005368f8a15d6e49081ecd))

## [1.3.0](https://github.com/reqcore-inc/reqcore/compare/v1.2.0...v1.3.0) (2026-04-03)


### ✨ Features

* add AI configuration seeding and demo data reset script ([927cf1e](https://github.com/reqcore-inc/reqcore/commit/927cf1ed6fea90325e0dadf362b4ab2000c767f3))
* add db:reseed script and implement demo organization deletion script ([f0f8b2e](https://github.com/reqcore-inc/reqcore/commit/f0f8b2e41ec3fa0c315b5cf9167e89e371da9d3f))
* add Deploy on Railway badge to README, enhance ScoreBreakdown component with caching, and introduce DemoUpsellBanner component ([c372668](https://github.com/reqcore-inc/reqcore/commit/c372668570a16723870868c605382c0876cca3ab))
* add document parsing functionality ([e6279d0](https://github.com/reqcore-inc/reqcore/commit/e6279d004612cc1544f1f1c9f957cef55bb4440e))
* add robots.txt for SEO optimization and allow indexing of job board pages ([0c387ba](https://github.com/reqcore-inc/reqcore/commit/0c387ba70d0c46b26253f0fe62c26be72f7af2ca))
* add Settings page for job management and update job tabs in AppTopBar ([7dba4da](https://github.com/reqcore-inc/reqcore/commit/7dba4dac492d31a75b2d5faab176cbe4a693960f))
* add Source Tracking page with initial layout and SEO metadata ([750dc0b](https://github.com/reqcore-inc/reqcore/commit/750dc0bed5eb0daa790453ac7013485b525a7fa4))
* add tracking link schemas for creation, update, and querying ([9d60aaf](https://github.com/reqcore-inc/reqcore/commit/9d60aaf694787a6e65f527fed313535a312aa808))
* add tracking link schemas for creation, update, and querying ([558e054](https://github.com/reqcore-inc/reqcore/commit/558e054d71a8f8fc496d02f6876220ebf3f3bf83))
* add WordExtractor type declarations and update document permissions ([6f66efd](https://github.com/reqcore-inc/reqcore/commit/6f66efdbf34dbf38f1c6867dd9995f8001047dc3))
* **ai-analysis:** add AI analysis dashboard and stats endpoint with tests ([c09ea21](https://github.com/reqcore-inc/reqcore/commit/c09ea21741f63bf7b3c175418ff6ab552489c2d3))
* **ai:** enhance AI scoring and configuration with rate limiting and error handling improvements ([71f0185](https://github.com/reqcore-inc/reqcore/commit/71f0185d55c029cd8e20525828b4d196a426bd73))
* **analytics:** enhance PostHog consent management and user identification for GDPR compliance ([0632620](https://github.com/reqcore-inc/reqcore/commit/063262098bc4172c8ddecf6fa5a5740e45a9b338))
* **api:** add candidate timeline endpoint and tracking link stats endpoint ([46e1e15](https://github.com/reqcore-inc/reqcore/commit/46e1e154b5346f90b9bad0cd46ba7665f300aa04))
* **delete-demo-org:** invalidate sessions for demo organization before deletion ([b8ee811](https://github.com/reqcore-inc/reqcore/commit/b8ee81198f8f558ab921684ef1b27495fab0ab67))
* enhance analytics consent management with cross-domain linking and event buffering ([7a9dd82](https://github.com/reqcore-inc/reqcore/commit/7a9dd82ede3ae275c97f66ebbcd8efba0d0b6353))
* enhance analytics event handling by flushing pending events on consent and organization creation ([2212af8](https://github.com/reqcore-inc/reqcore/commit/2212af82b1d7ebb949bd3a50014fb40dd55ce8a9))
* enhance event tracking by persisting pending events in sessionStorage ([95c48ce](https://github.com/reqcore-inc/reqcore/commit/95c48cee281e4a35b0f237bcb88668812ed13011))
* enhance LanguageSwitcher component with drop-up option and impr… ([5aea684](https://github.com/reqcore-inc/reqcore/commit/5aea684d31412734786fd96b7816fc9322865936))
* enhance LanguageSwitcher component with drop-up option and improve layout for candidate and job detail pages ([ccc829e](https://github.com/reqcore-inc/reqcore/commit/ccc829ea2f757a9beb1f8be9c317fb435ca0106a))
* enhance mobile responsiveness and scrollbar visibility across components ([ab939bb](https://github.com/reqcore-inc/reqcore/commit/ab939bbd644264608e6788cfe48d04f71bb279d0))
* enhance mobile responsiveness and scrollbar visibility across components ([5ecc098](https://github.com/reqcore-inc/reqcore/commit/5ecc098d777b2141c696d4687f3baa54c96de4b3))
* enhance resume parser with PDF polyfills and dynamic import for pdf-parse ([2d6dea5](https://github.com/reqcore-inc/reqcore/commit/2d6dea5bb7a2d92150cca330cbd334526cd619e4))
* enhance timeline functionality with collapsible sections and candidate grouping ([b8c6ab9](https://github.com/reqcore-inc/reqcore/commit/b8c6ab91f9b8d5dcb8e71186b4c10198ea394a10))
* Implement AI scoring system with provider integration and criteria management ([6ba3159](https://github.com/reqcore-inc/reqcore/commit/6ba31596f7fe239611901b99c2c60f430166e84a))
* Implement AI scoring system with provider integration and criteria management ([8158718](https://github.com/reqcore-inc/reqcore/commit/8158718f8421903c5df639bb5731f6361d39685f))
* implement autoScoreApplication for AI-driven application scoring ([5222980](https://github.com/reqcore-inc/reqcore/commit/5222980ea02aa92fa44b048157717bc23c3e370a))
* implement combined demo-check and sign-out endpoint for fresh sign-up flow ([a5632bd](https://github.com/reqcore-inc/reqcore/commit/a5632bd865610f6f1a4fb9196df9b95d06d9db93))
* implement demo-aware signup redirect with server-side session check ([092d324](https://github.com/reqcore-inc/reqcore/commit/092d3241a96ff78b7ddc9068c1c0f8bfac6e00ba))
* implement internationalization for navigation and hero sections across multiple languages ([7720fc8](https://github.com/reqcore-inc/reqcore/commit/7720fc85fb3dba24fda9f87dc595522e235504ef))
* implement server-side demo organization check for fresh sign-up flow ([3075a17](https://github.com/reqcore-inc/reqcore/commit/3075a17cb9d87c64a81d947bd51efb5e99f34583))
* implement Timeline page with activity log and infinite scroll functionality ([5b1c694](https://github.com/reqcore-inc/reqcore/commit/5b1c6941af4b4f203cc9ad0a784bce01b7e25017))
* implement Timeline page with activity log and infinite scroll functionality ([abda1a3](https://github.com/reqcore-inc/reqcore/commit/abda1a3e325feb919d51e6887d0bf69c7c76bb0e))
* implement tracking for various user actions and API events in the application ([674993c](https://github.com/reqcore-inc/reqcore/commit/674993c330ee1c3200015e8a51d243cfa662d40c))
* improve demo organization check by ensuring demo slug is validated before redirecting ([b60b9bc](https://github.com/reqcore-inc/reqcore/commit/b60b9bc9a102c4086fb30cc32b0d90d057aaecea))
* **jobs:** add remote status and experience level fields to job creation form ([405ee5b](https://github.com/reqcore-inc/reqcore/commit/405ee5bb9c2f7b7123ef6067855403b05410e869))
* **jobs:** enhance job application form with AI integration warnings and improved field descriptions ([2bcae86](https://github.com/reqcore-inc/reqcore/commit/2bcae86ee89f51364f11a406ec2b26ff6ffcd936))
* **logging:** integrate OpenTelemetry for structured logging to PostHog ([3f62f29](https://github.com/reqcore-inc/reqcore/commit/3f62f29793dffe3eea610c6c738cedd2f95104ed))
* **logging:** refine log attributes type for improved type safety in PostHog API tracking ([38f46b3](https://github.com/reqcore-inc/reqcore/commit/38f46b3711e1fe3a200c86067a2ce2fe685c8ad6))
* **logging:** replace console.error with structured logging for error handling across multiple modules and add Vitest setup for logging stubs ([ded88f8](https://github.com/reqcore-inc/reqcore/commit/ded88f8f683ee3f3038ca1ae4b95ba7d63ae63ad))
* **logging:** replace console.error with structured logging for error handling across various modules ([4451b95](https://github.com/reqcore-inc/reqcore/commit/4451b954f7329ed9dc6bedb76225503551bbafec))
* migrate analytics consent management from localStorage to cross-domain cookies ([59e5e33](https://github.com/reqcore-inc/reqcore/commit/59e5e33026451c640acea1ef9b977d617aec6fdd))
* propagate source tracking parameters through job application flow ([60bdc55](https://github.com/reqcore-inc/reqcore/commit/60bdc55ef55390744aaa8555506cdd741352a323))
* refactor demo session checks to use user email for demo account detection ([c747d24](https://github.com/reqcore-inc/reqcore/commit/c747d24f346f6169444abfee2d163ab221fe6cd2))
* refactor demo sign-up flow by removing demo-fresh-signup endpoint and handling session checks in fresh-signup component ([58be8e0](https://github.com/reqcore-inc/reqcore/commit/58be8e0096005c8ffad56937134cc3abbc7126c8))
* refactor demo sign-up flow by replacing POST endpoint with GET for better cookie handling ([e4268eb](https://github.com/reqcore-inc/reqcore/commit/e4268eb346df996379bae987705dada182fe78df))
* refactor timeline component to simplify candidate grouping and remove unused action groups ([8d226c8](https://github.com/reqcore-inc/reqcore/commit/8d226c86819743f46a6b80d615d81c4be6f2c8ea))
* **session-management:** implement session expiration handling and UI feedback for demo accounts ([3a6c1f4](https://github.com/reqcore-inc/reqcore/commit/3a6c1f40922df16520f679d58789e02aaa34e3ab))
* **source-tracking:** add tracking links management and attribution ([8d25601](https://github.com/reqcore-inc/reqcore/commit/8d256017c9bed1a279cebaeda93fa5c34be27a29))
* **source-tracking:** enhance tracking links management with dynamic URL generation and sorting functionality ([877d03c](https://github.com/reqcore-inc/reqcore/commit/877d03c1b515864f9204f3b9eeff6a7da53636f2))
* **timeline:** enhance timeline action styles and status badges ([475e643](https://github.com/reqcore-inc/reqcore/commit/475e6433d665afb2bf364bd418319419685cc62b))
* **timeline:** implement TimelineDateLink component for date navigation and update date displays across applications ([be4a438](https://github.com/reqcore-inc/reqcore/commit/be4a438047c830bf0f2d5ad59973398e231fc818))
* **tracking-links:** implement collision handling for unique tracking code generation and enhance validation for tracking codes ([88489e6](https://github.com/reqcore-inc/reqcore/commit/88489e604485fb35b343ac8f795517eed1e1377e))
* update button labels for clarity and consistency in job creation flow ([850383c](https://github.com/reqcore-inc/reqcore/commit/850383c81066470f665bc3fb323619f8a0c134d4))
* update Open Graph image and disable exception autocapture in server config ([ad98fae](https://github.com/reqcore-inc/reqcore/commit/ad98faee2ee4678e8fbfc852add91e26c5184c15))
* update scoring criteria steps in candidate application, job creation, and resume upload tests ([30d87f0](https://github.com/reqcore-inc/reqcore/commit/30d87f07583d4eba9dbf3db35a0e604425ebcfb9))


### ♻️ Refactoring

* update layout and styling for settings pages ([2cb9723](https://github.com/reqcore-inc/reqcore/commit/2cb97235c7f4a0282268edddbc2983d134f020a9))
* update status and transition classes for improved UI consistency ([597f069](https://github.com/reqcore-inc/reqcore/commit/597f069962e0b0677d04f555dd9a6c74bdeaa6ce))

## [1.2.0](https://github.com/reqcore-inc/reqcore/compare/v1.1.0...v1.2.0) (2026-03-16)


### ✨ Features

* add email template management system ([616ada5](https://github.com/reqcore-inc/reqcore/commit/616ada516992a2fd7c33b941b7b12f7a6b5467c0))
* add email template validation schemas and pre-made templates ([7879e38](https://github.com/reqcore-inc/reqcore/commit/7879e38e2e54f7f3ac07d84faec3e36103ea0ded))
* add fullscreen toggle functionality to job detail view ([a94e4b6](https://github.com/reqcore-inc/reqcore/commit/a94e4b628922e41154abbeafd351be67e33e5685))
* add functionality to move applications directly to interview stage without scheduling ([22e6a0a](https://github.com/reqcore-inc/reqcore/commit/22e6a0ac2a80c41d5e38ca2164f7cf70fd3c4832))
* add Greenhouse vs Open Source ATS comparison article and enhance existing content with links ([8c2e225](https://github.com/reqcore-inc/reqcore/commit/8c2e2259b71cdf52405378c514594b3feed8b1c1))
* add iCalendar generation for interview invitations ([57e692a](https://github.com/reqcore-inc/reqcore/commit/57e692a253befb4675487e58ef2d5475b284a218))
* add interview scheduling functionality with sidebar integration ([0eb29b0](https://github.com/reqcore-inc/reqcore/commit/0eb29b068d38f04f7289589051e9d53d4c5a2f57))
* add interview validation schemas for creation, updating, and querying ([a93da4e](https://github.com/reqcore-inc/reqcore/commit/a93da4ec16862dacd43ebb9efbb339a84492f502))
* add interview validation schemas for creation, updating, and querying ([be8f623](https://github.com/reqcore-inc/reqcore/commit/be8f62375cb7a5798f9133dcf454eea7f835617b))
* add interviews dashboard page with filtering, editing, and deleting functionalities ([59bdb36](https://github.com/reqcore-inc/reqcore/commit/59bdb36d5ba33a280f20c39ceb9b9eb53fa2eeec))
* add middleware for 301 redirect from legacy domain to canonical domain ([5525cf6](https://github.com/reqcore-inc/reqcore/commit/5525cf6efa0c7e94220f58d2af2e7cf5e145affd))
* add realistic interview data and scheduling logic to seed script ([e3b1881](https://github.com/reqcore-inc/reqcore/commit/e3b188148eaf7bb484bff148b8cbe45a8eda1cb8))
* add realistic interview data and scheduling logic to seed script ([467cc56](https://github.com/reqcore-inc/reqcore/commit/467cc56a98504d53445e0538526a63f572a60602))
* add script to backfill google_calendar_event_link for existing interviews ([c46d13d](https://github.com/reqcore-inc/reqcore/commit/c46d13da86b1bd5937b354647e98bf7e3561fe61))
* add teleport target prop to modals for improved flexibility in rendering ([78a3ae8](https://github.com/reqcore-inc/reqcore/commit/78a3ae8729fff28622104a7e8cdbca4d66c27dd7))
* add use case guide for open source ATS adoption by company size and industry ([f9770e5](https://github.com/reqcore-inc/reqcore/commit/f9770e56d947f6b1ca9e387febcb2cebc6115e68))
* **AppTopBar:** remove unused transition classes for user menu ([49976c3](https://github.com/reqcore-inc/reqcore/commit/49976c38d587ee05c09b59dd2226632529cadb33))
* **auth:** add fresh signup page with redirect functionality ([f0ae97f](https://github.com/reqcore-inc/reqcore/commit/f0ae97f93ced497b3544615d7cebaaef8fc5cb57))
* **auth:** enhance error handling for sign-in and sign-up processes, including BETTER_AUTH_URL mismatch detection ([dd29c49](https://github.com/reqcore-inc/reqcore/commit/dd29c4949feb422d54a75097dfb3517bbae1bf2e))
* **auth:** improve BETTER_AUTH_URL handling for Railway environments and enhance validation ([e368cc8](https://github.com/reqcore-inc/reqcore/commit/e368cc8834bd07f0fe5674e9f25960d5b43224a1))
* **auth:** improve BETTER_AUTH_URL handling for Railway environments… ([ef155aa](https://github.com/reqcore-inc/reqcore/commit/ef155aa8f35666f5ec129f2bb288365581a43138))
* **calendar:** add Google Calendar integration with OAuth2 flow ([08f778a](https://github.com/reqcore-inc/reqcore/commit/08f778a49feacfd41f3b78853b66251998bd499f))
* **calendar:** add Google Calendar sync status indicators in interview components ([bb5244a](https://github.com/reqcore-inc/reqcore/commit/bb5244adc2ce0e61e1ecd9b7f8a725de675ede66))
* **calendar:** update webhook renewal to require specific permissions and enhance error handling in sync process ([140d6ac](https://github.com/reqcore-inc/reqcore/commit/140d6ac690b0752d6205035df0d069f61ec2e418))
* centralize system email templates in shared module for improved maintainability ([e05b877](https://github.com/reqcore-inc/reqcore/commit/e05b8778defb25981658bdf197ff311d43f0cb71))
* create HMAC-signed tokens for candidate interview responses ([57e692a](https://github.com/reqcore-inc/reqcore/commit/57e692a253befb4675487e58ef2d5475b284a218))
* **dark mode:** enhance checkbox and radio styles for dark mode rendering ([728feb2](https://github.com/reqcore-inc/reqcore/commit/728feb2443087d893feacc7e0afa3db12c9ed5b0))
* **dashboard:** enhance job management and pipeline tracking ([a60f489](https://github.com/reqcore-inc/reqcore/commit/a60f4893a633768525adfdea7eaf1ed5b5a17f50))
* **dashboard:** update job pipeline display logic to use application count ([b75b0e5](https://github.com/reqcore-inc/reqcore/commit/b75b0e51442fa7d96b2d5bd07ea77baa5debd3eb))
* **demo:** add 'Get Started' options for demo mode in AppTopBar and enhance PreviewUpsellModal ([8c530cf](https://github.com/reqcore-inc/reqcore/commit/8c530cf58f90932d915e8ffd5bec2f07b83d6997))
* **demo:** add 'Get Started' options for demo mode in AppTopBar and enhance PreviewUpsellModal ([e607520](https://github.com/reqcore-inc/reqcore/commit/e607520af5e118a32c7e0bf496d90642fe471831))
* **docker:** add CHANGELOG.md to Docker image for runtime access ([b7af4ce](https://github.com/reqcore-inc/reqcore/commit/b7af4ce41414bcca89ee3b51f9fbe62ff944463d))
* enhance interview management with inline editing and rescheduling features ([ef5cdbb](https://github.com/reqcore-inc/reqcore/commit/ef5cdbb68a2421c6c00c080edece1e93406417ff))
* enhance webhook handling with cron secret validation and improve interview ID validation ([457af10](https://github.com/reqcore-inc/reqcore/commit/457af10fe8f160c066e7ae4611e8c0e5a5e3b8a0))
* **google-calendar:** update integration instructions and add environment variable details ([be9ccbd](https://github.com/reqcore-inc/reqcore/commit/be9ccbd669c19f5eb9d60241abe3f70080246eac))
* implement advanced filtering and sorting options for job applications ([27f179e](https://github.com/reqcore-inc/reqcore/commit/27f179ec274545fb485cfc9aad56b986415a2ad7))
* implement sortable candidate and application tables with improved UI ([9188d3b](https://github.com/reqcore-inc/reqcore/commit/9188d3b5bb6dcdb4f105ae35a2c009721317a9f9))
* improve date formatting helper to return local timezone date string ([ddda624](https://github.com/reqcore-inc/reqcore/commit/ddda62492e58a38a79eb5f67a46311f32a0d6c58))
* integrate email template selection for interview invitations ([771917f](https://github.com/reqcore-inc/reqcore/commit/771917fd9b180b4babcfb6eb0c0192c4b5e44ebb))
* **interview:** add Google Calendar notification preferences and customization options ([6c942d0](https://github.com/reqcore-inc/reqcore/commit/6c942d0b6015f0a74d60c74612d8392e1ea6c4b4))
* **interview:** enhance interview scheduling with Google Calendar integration and email validation ([58810b1](https://github.com/reqcore-inc/reqcore/commit/58810b17e10064336d80a8de508a043070e7963d))
* make candidate email addresses clickable for improved user interaction ([2c01f77](https://github.com/reqcore-inc/reqcore/commit/2c01f77eacf98dc94a196d067cc5395532e0eb98))
* refactor interview management with enhanced status transitions and email template integration ([6033d06](https://github.com/reqcore-inc/reqcore/commit/6033d065e7bb1985af78dc12ee2091b96a52ca18))
* **tracking:** implement privacy-respecting event tracking across various pages and actions ([ebb22c9](https://github.com/reqcore-inc/reqcore/commit/ebb22c91a1d60f86f75a089e25b529ae851a5da8))
* **updates:** add API endpoints for update management, backup, chang… ([e8432e5](https://github.com/reqcore-inc/reqcore/commit/e8432e52cde8c035a704d26b2b7bd79523b3ce2e))
* **updates:** add API endpoints for update management, backup, changelog, system info, and version check ([3a5d96e](https://github.com/reqcore-inc/reqcore/commit/3a5d96e8e5c453974a3d17a5b470b924f656aaf5))
* **updates:** enhance backup functionality and improve update checks with error handling ([1921be8](https://github.com/reqcore-inc/reqcore/commit/1921be8c883085b4590497cda2157f39959b31e6))


### 🐛 Bug Fixes

* cast return type of getAuth function to Auth ([665e059](https://github.com/reqcore-inc/reqcore/commit/665e05932061f83c1c3b73aa729a54a3ef571ffb))
* correct promise chaining for Google Calendar event creation ([a935615](https://github.com/reqcore-inc/reqcore/commit/a935615e2eae720111672fa34d135163f31f4121))
* **issue-template:** enable blank issues in configuration ([b634752](https://github.com/reqcore-inc/reqcore/commit/b6347524088d46401b7ff48776666d839c0ee509))
* update G2 ranking link for Greenhouse in ATS comparison article ([c46549e](https://github.com/reqcore-inc/reqcore/commit/c46549ec9e258a85d8e9c3bd63cbea549f0ec630))


### ♻️ Refactoring

* simplify refreshNuxtData calls in useInterview composable and remove unused migration placeholder ([b9533fe](https://github.com/reqcore-inc/reqcore/commit/b9533fece569f9c2d4f1ae75960f28f17a115f29))

## [1.1.0](https://github.com/reqcore-inc/reqcore/compare/v1.0.0...v1.1.0) (2026-03-10)


### ✨ Features

* add new article on best free ATS software for startups and update related content ([021f8db](https://github.com/reqcore-inc/reqcore/commit/021f8db2351260cd5e2ac738aa571da85e91f4dc))
* add new article on the differences between open source and free ATS, including a comprehensive guide and internal links ([da31e77](https://github.com/reqcore-inc/reqcore/commit/da31e77ba6187f7c8faa6ddb1d626c1fdfe57d82))
* add release automation configuration and update versioning ([a37c1cc](https://github.com/reqcore-inc/reqcore/commit/a37c1cc8f032816ab10a184ad3b487d65b5997a7))
* **analytics:** integrate PostHog for user analytics and consent management ([8bd4bd5](https://github.com/reqcore-inc/reqcore/commit/8bd4bd50cb62254e9d39f8c92214c2af24b8671c))
* **analytics:** integrate PostHog for user analytics and consent management ([619f239](https://github.com/reqcore-inc/reqcore/commit/619f239c06a865a2d1a091a1d5f85a941548b5a7))
* **consent:** implement consent banner for analytics tracking and update privacy policy ([24a9201](https://github.com/reqcore-inc/reqcore/commit/24a920163ecf9a3a9a65d4476f115dd34357a34b))
* **consent:** simplify consent message for clarity in analytics tracking ([c28356a](https://github.com/reqcore-inc/reqcore/commit/c28356a27eea15715e686cd83686ac7cdb6bd29b))
* **consent:** update wording in consent banner for improved clarity ([91c6550](https://github.com/reqcore-inc/reqcore/commit/91c655032d8e3cf515b065b9fe13e216f460c90d))
* **database:** enhance database URL resolution with fallback handling for environment variables ([0302102](https://github.com/reqcore-inc/reqcore/commit/0302102c984b04642cd2e4de2bbb4cdcdf88b185))
* **dependencies:** update PostHog CLI and related packages for improved functionality ([f532a3e](https://github.com/reqcore-inc/reqcore/commit/f532a3e3c53d522b1d11c93314cf91252400a6f3))
* **interviews:** add Interview interface for managing interview data structure ([da4e78d](https://github.com/reqcore-inc/reqcore/commit/da4e78dc6552b14201432429229a10363eaf5748))
* **navbar:** replace static navbar with reusable PublicNavBar component across blog, catalog, docs, and roadmap pages ([a0d17db](https://github.com/reqcore-inc/reqcore/commit/a0d17dbcfe3613d2f5817f54ee9b46758a350ad5))
* **nuxt:** conditionally load PostHog module based on API key availability to prevent crashes ([ddb1f59](https://github.com/reqcore-inc/reqcore/commit/ddb1f599ea56b4d938cb8c50b754fac4561070fd))
* **posthog:** add PostHog configuration for server-side event capture ([9958fe5](https://github.com/reqcore-inc/reqcore/commit/9958fe5d37ea75366216bcbd5a2187346c62c938))
* **posthog:** enhance analytics consent management and data minimization in PostHog integration ([92588d9](https://github.com/reqcore-inc/reqcore/commit/92588d9a3a3801eea7e63bae46d773a9e2dc771c))
* **posthog:** enhance PostHog integration with consent handling and graceful shutdown ([5e708fa](https://github.com/reqcore-inc/reqcore/commit/5e708faf1b3808fc24f4a6c51285eb9a4920004b))
* **posthog:** replicate safe accessor for PostHog in composables and plugins to ensure compatibility when not configured ([1e948cb](https://github.com/reqcore-inc/reqcore/commit/1e948cbc2e9543e54756f553327454e70c726702))
* **posthog:** update PostHog integration with environment variables and consent handling ([4b745ec](https://github.com/reqcore-inc/reqcore/commit/4b745ec2f9e768ad11e113799d3b63e17a6cef60))
* **posthog:** update PostHog integration with environment variables and consent handling ([4c11f99](https://github.com/reqcore-inc/reqcore/commit/4c11f99c9bc1331989c80b78bf793dd63ec2584f))


### 🐛 Bug Fixes

* add config and manifest file parameters to release-please action ([ff30b11](https://github.com/reqcore-inc/reqcore/commit/ff30b11bbcaea0d7ab92be887e008edc656ba5cc))
* **posthog:** read server PostHog config from env vars directly ([74ae687](https://github.com/reqcore-inc/reqcore/commit/74ae6874e2019944bf8d71f314fb2dfc988b7658))
* **posthog:** update proxy targets for PostHog integration with environment variable notes ([da4e78d](https://github.com/reqcore-inc/reqcore/commit/da4e78dc6552b14201432429229a10363eaf5748))
* **release:** remove pull request header from release configuration ([9636fd5](https://github.com/reqcore-inc/reqcore/commit/9636fd5581032283af5c89b8be654ea01ae5fa6f))
* update token in release-please action for proper authentication ([5ae917e](https://github.com/reqcore-inc/reqcore/commit/5ae917e3c30cd5e819a1be97045e4890d4ac0f7b))

## 2026-03-08

### Added

- **Blog: Best Free ATS Software for Startups (2026)** — Cluster 2 supporting roundup article. Compares 7 free ATS tools across three "free" models (free-forever, free trial, open source), with startup-specific evaluation criteria and upgrade signals. Published to `content/blog/best-free-ats-software-for-startups.md`
- **Internal links** — added cross-links from `best-open-source-applicant-tracking-systems.md` (Cluster 2 pillar) and `open-source-vs-free-ats.md` (Cluster 1) to new article

## 2026-03-07

### Added

- **Blog: Open Source vs Free ATS: Why They Aren't the Same** — Cluster 1 supporting article. Explains the difference between free (proprietary) and open source ATS, introduces a 4-category ATS pricing spectrum framework, and includes real infrastructure cost data. Published to `content/blog/open-source-vs-free-ats.md`
- **Internal link** — added cross-link from `open-source-applicant-tracking-system.md` (Cluster 1 pillar) to new supporting article

## 2026-03-04

### Added

- **Blog: How Does an Applicant Tracking System Work?** — Cluster 1 supporting article. Covers the ATS workflow from job posting to hiring decision, resume parsing mechanics, pipeline stages, candidate scoring methods (keyword vs rules vs AI), data ownership, and integrations. Published to `content/blog/how-applicant-tracking-systems-work.md`
- **Internal link** — added cross-link from `open-source-applicant-tracking-system.md` (Cluster 1 pillar) to new supporting article

## 2026-02-28

### Added

- **Blog: OpenCATS vs Reqcore: Open Source ATS Head-to-Head** — Published to `content/blog/opencats-vs-reqcore.md`
- **Internal link** — added cross-link from `best-open-source-applicant-tracking-systems.md` to new post

## 2026-02-22

### Added

- **Blog: Best Open Source Applicant Tracking Systems [2026]** — Cluster 2 pillar page. 3,800-word comparison of 7 open source ATS platforms with TCO analysis, evaluation framework, and FAQ. Published to `content/blog/best-open-source-applicant-tracking-systems.md`
- **Internal link** — added cross-link from `self-hosted-vs-cloud-ats.md` to new pillar page

### Fixed

- **Railway PR seed execution** — removed hard `.env` dependency from `db:seed`; seeding now works with platform-injected env vars and still supports local `.env` loading in `seed.ts`

### Changed

- **Unified Railway seeding path** — Railway predeploy now runs `db:seed` (same script as standard demo data), removing PR-specific seed divergence between preview and production-like environments
- **Preview demo defaults aligned** — runtime preview fallbacks now target `reqcore-demo` and `demo@reqcore.com` to match `server/scripts/seed.ts`

### Removed

- **PR-only seed script** — removed `server/scripts/seed-pr.ts` and the `db:seed:pr` npm script

---
## 2026-02-21

### Fixed

- **Dependency security remediation** — resolved all `npm audit --audit-level=high` findings by upgrading `@aws-sdk/client-s3` (pulling patched `@aws-sdk/xml-builder`) and regenerating lockfile resolution
- **Transitive vulnerability pinning** — added npm `overrides` for `fast-xml-parser`, `minimatch`, `tar`, and `readdir-glob` to keep vulnerable transitive ranges out of the install graph
- **Demo write-protection enforcement** — hardened server demo guard so `POST`/`PATCH`/`PUT`/`DELETE` requests are consistently blocked for the configured demo organization and no longer silently fail open when demo org lookup fails
- **Dashboard preview UX** — write attempts in preview mode now trigger a dedicated upsell modal instead of only inline/API errors, while keeping action buttons visible

### Changed

- **Lockfile hygiene** — refreshed dependency graph with `npm install` + `npm dedupe` to remove stale vulnerable transitive entries
- **Demo env guidance** — `.env.example` demo slug example now matches seeded demo organization slug (`reqcore-demo`) to reduce configuration drift

---
## 2026-02-19

### Changed

- **Deployment platform migration** — migrated from Hetzner VPS (Caddy + systemd) to Railway (managed Nuxt service, Railway PostgreSQL, Railway Storage Buckets)
- **S3 path style now configurable** — `S3_FORCE_PATH_STYLE` env var controls path-style vs virtual-hosted-style S3 URLs (MinIO vs Railway Buckets/AWS S3)
- **S3 bucket plugin** — skips bucket initialization on managed providers (Railway/AWS) where buckets are pre-provisioned
- **`.env.example`** — expanded with full documentation, Railway-specific variable references, and all env vars

### Added

- **`start` script in `package.json`** — `node .output/server/index.mjs` for Railway Nixpacks detection

---
## 2026-02-18

### Added

- **Organic SEO foundation** — `@nuxtjs/seo` (Sitemap, Robots, Schema.org, SEO Utils, Site Config) and `@nuxt/content` v3 (Markdown blog engine with typed collections)
- **Dynamic sitemap** — all open job postings auto-included via `/api/__sitemap__/urls`
- **Robots directives** — `/dashboard/`, `/auth/`, `/api/`, `/onboarding/` blocked from crawling; `noindex` on auth, onboarding, apply, and confirmation pages
- **JSON-LD structured data** — `JobPosting` on job detail (salary, location, remote, employment type), `Organization` + `WebSite` + `WebPage` on landing page, `Article` on blog posts
- **Job SEO fields** — `salaryMin`, `salaryMax`, `salaryCurrency`, `salaryUnit`, `remoteStatus`, `validThrough` added to job schema and all CRUD endpoints
- **Full OG + Twitter Card meta** on all public pages (landing, job board, job detail, roadmap, blog)
- **Blog** — listing page, article detail page with `@tailwindcss/typography` prose styling, seed article "Self-Hosted vs Cloud ATS: Pros, Cons, and When to Switch"
- **ISR route rules** — `/jobs/**` (3600s stale-while-revalidate), prerender for `/`, `/roadmap`, `/blog/**`
- **SVG favicon** — purple rounded rect with white "A"

### Changed

- **Landing page H1** — from "The recruitment engine you actually own" to "The open-source ATS you actually own" for keyword targeting
- **Landing page meta description** — optimized for "open source ATS", "self-hosted", "applicant tracking system" keywords
- **Public job API** — now joins organization table to expose `organizationName` for JSON-LD `hiringOrganization`
- **Navigation** — "Blog" link added to landing page navbar/footer and roadmap page navbar

---
## 2026-02-16

### Added

- **In-app feedback** — floating button in the dashboard opens a modal to submit bug reports or feature requests directly as GitHub Issues. Server-side GitHub API integration with fine-grained PAT (token never exposed to client). Per-user rate limiting (5/hour). Auto-labels issues (`bug` / `enhancement`). Includes reporter context (name, email, page URL). Gracefully hidden when `GITHUB_FEEDBACK_TOKEN` / `GITHUB_FEEDBACK_REPO` env vars are not set.
- **Production deployment** — deployed to Hetzner Cloud CX23 (2 vCPU, 4GB RAM, Ubuntu 24.04) with Caddy reverse proxy, systemd service management, and one-command deploy script (`~/deploy.sh`)
- **Cloudflare CDN** — DNS, DDoS protection, edge caching, SSL termination (Full strict mode), and AI training bot blocking via Cloudflare Free plan
- **Deploy workflow** — `ssh deploy@server '~/deploy.sh'` pulls latest code, installs deps, builds, and restarts the systemd service
- **UFW firewall** — only ports 22 (SSH), 80 (HTTP), 443 (HTTPS) open

### Fixed

- **S3 bucket policy MinIO compatibility** — replaced `PutBucketPolicy` with `DeleteBucketPolicy` because MinIO doesn't support the `aws:PrincipalType` condition key used in the deny-anonymous policy; buckets without a policy are private by default in MinIO

### Changed

- **S3 bucket privacy strategy** — instead of setting an explicit deny-all policy (which used AWS-only condition keys), the startup plugin now deletes any existing bucket policy to ensure MinIO's default private behavior

---
## 2026-02-15

### Added

- **Recruiter dashboard** (`app/pages/dashboard/index.vue`) — at-a-glance overview with four stat cards (Open Jobs, Total Candidates, Applications, Unreviewed), pipeline breakdown bar chart with color-coded status segments, jobs by status breakdown, recent applications list with relative timestamps, and top active jobs with new-application badges
- **Dashboard stats API** (`server/api/dashboard/stats.get.ts`) — single endpoint returning all dashboard data: summary counts, pipeline breakdown, jobs by status, recent 10 applications with candidate/job info, and top 5 active jobs by application count — all org-scoped with parallel query execution
- **Dashboard composable** (`app/composables/useDashboard.ts`) — wraps stats endpoint with computed unwrappers for all dashboard sections
- Quick action buttons (Create Job, Add Candidate) in dashboard header
- Welcome empty state for new organizations with CTA to create first job
- Loading skeleton states for all dashboard widgets
- **Public roadmap page** (`app/pages/roadmap.vue`) — cinematic horizontal-scrolling timeline with 15 glassmorphism milestone cards, color-coded by status (shipped/building/vision), scroll-tracking progress glow on the timeline axis, smooth mousewheel-to-horizontal scroll conversion via requestAnimationFrame, and intro card centered on page load
- **Roadmap showcase section on landing page** — "Built in the open" section with mini timeline showing Shipped/Building/Vision counts and prominent CTA to full roadmap
- **Roadmap navigation links** — Roadmap link added to landing page navbar and footer

---
## 2026-02-14

### Added

- **Dynamic sidebar job tabs** — when viewing a specific job (`/dashboard/jobs/:id/*`), the sidebar shows contextual sub-navigation: Overview, Pipeline, Application Form
- **Application Form tab page** (`app/pages/dashboard/jobs/[id]/application-form.vue`) — dedicated page for custom questions management and shareable application link
- **Sidebar icons** — all main nav items now display Lucide icons (LayoutDashboard, Briefcase, Users, Inbox, LogOut)
- **"All Jobs" sidebar back-link** — quick return to jobs list from any job sub-page

### Changed

- **Sidebar redesign** — replaced scoped CSS with Tailwind utility classes; added dynamic job context section with tab-based navigation
- **Dashboard layout** — removed `max-w-4xl` wrapper from `dashboard.vue`; each page now controls its own `mx-auto max-w-*` for proper centering
- **All dashboard pages** — added `mx-auto` to root elements for centered content within the main area
- **Dashboard index** — converted from `<style scoped>` to Tailwind utility classes
- **Job detail page** — removed "Back to Jobs" link, "View Pipeline" button, application link section, and Application Form Questions section (all moved to sidebar tabs / dedicated application-form page)
- **Pipeline page** — removed "Back to Job" link (sidebar provides navigation)

### Removed

- **"Back to X" links** on job sub-pages — sidebar now provides all navigation context
- **Scoped CSS** in `AppSidebar.vue` and `dashboard/index.vue` — replaced with Tailwind utilities

---
