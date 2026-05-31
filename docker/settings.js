module.exports = {
    // ── Server ────────────────────────────────────────────────────────────────
    uiPort: process.env.PORT || 1880,
    uiHost: '0.0.0.0',

    // ── Auth ──────────────────────────────────────────────────────────────────
    // No admin auth for local dev. Add adminAuth to lock down in production.
    // adminAuth: { type: 'credentials', users: [{ username: 'admin', password: '...', permissions: '*' }] },

    // ── Credential encryption ─────────────────────────────────────────────────
    // Value comes from NODE_RED_CREDENTIAL_SECRET env var (set in docker-compose).
    credentialSecret: process.env.NODE_RED_CREDENTIAL_SECRET || 'hoymiles-dev-secret',

    // ── Flows ─────────────────────────────────────────────────────────────────
    flowFile: 'flows.json',
    flowFilePretty: true,

    // ── Editor ────────────────────────────────────────────────────────────────
    editorTheme: {
        tours: false,
        projects: { enabled: false },
    },

    // ── Logging ───────────────────────────────────────────────────────────────
    logging: {
        console: {
            level: 'info',
            metric: false,
            audit: false,
        },
    },

    // ── Node settings ─────────────────────────────────────────────────────────
    functionExternalModules: true,
};
