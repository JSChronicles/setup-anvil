// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const shared = {
  output: {
    esModule: true,
    format: 'es',
    sourcemap: true
  },
  plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs()]
}

export default [
  {
    ...shared,
    input: 'src/setup-index.ts',
    output: { ...shared.output, file: 'dist/setup/index.js' }
  },
  {
    ...shared,
    input: 'src/shim-index.ts',
    output: { ...shared.output, file: 'dist/shim/index.js' }
  }
]
