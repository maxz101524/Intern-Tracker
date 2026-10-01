import { defaultDeps, handleLedger } from '../_lib/handlers.js'

export default {
  fetch(request: Request) {
    return handleLedger(request, defaultDeps())
  },
}
