import { computed } from 'vue'
import { useRoute } from 'vue-router'

function isEmbedValue (value: unknown): boolean {
  if (value === '1' || value === 'true') {
    return true
  }
  if (Array.isArray(value)) {
    return value.some(v => v === '1' || v === 'true')
  }
  return false
}

export function useEmbedMode () {
  const route = useRoute()

  const isEmbed = computed(() => {
    if (isEmbedValue(route.query.embed)) {
      return true
    }
    if (typeof window !== 'undefined') {
      const fromSearch = new URLSearchParams(window.location.search).get('embed')
      if (fromSearch === '1' || fromSearch === 'true') {
        return true
      }
    }
    return false
  })

  return { isEmbed }
}
