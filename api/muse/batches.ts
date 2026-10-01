import { defaultDeps, handleBatches } from '../_lib/handlers.js'

export default {
  fetch(request: Request) {
    return handleBatches(request, defaultDeps())
  },
}
