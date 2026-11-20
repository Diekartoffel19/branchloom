/** Portable Windows package. Forge rebuilds native SQLite and PTY modules. */
module.exports = {
  // A local diagnostic package can reuse native binaries already proven to
  // load in Electron. Release builds always rebuild them for Electron's ABI.
  rebuildConfig: process.env.JARVIS_STUDIO_SKIP_NATIVE_REBUILD === '1'
    ? { ignoreModules: ['better-sqlite3', 'node-pty'] }
    : {},
  packagerConfig: {
    name: 'Jarvis Studio',
    asar: false,
    ignore: [
      /^\/(?:\.git|\.github|\.githooks|\.venv|coverage|out|src|tests)(?:\/|$)/,
      /^\/(?:AGENTS\.md|vite\.config\.mts|vitest\.config\.mts|tsconfig\..*\.json)$/,
      /^\/(?:\.env(?:\..*)?|.*\.sqlite(?:-wal|-shm)?|.*\.log)$/,
    ],
  },
  makers: [{ name: '@electron-forge/maker-zip' }],
};
