<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const items: NavigationMenuItem[] = [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Episodes', icon: 'i-lucide-podcast', to: '/episodes' },
  { label: 'Playlists', icon: 'i-lucide-list-music', to: '/playlists' },
  { label: 'Grouping', icon: 'i-lucide-sparkles', to: '/grouping' },
  { label: 'Export', icon: 'i-lucide-upload', to: '/export' }
]

const footerItems: NavigationMenuItem[] = [
  { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' }
]
</script>

<template>
  <UDashboardGroup storage-key="rip-layout">
    <UDashboardSidebar collapsible resizable :ui="{ footer: 'border-t border-default' }">
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-scroll-text" class="size-5 shrink-0 text-primary" />
          <span v-if="!collapsed" class="truncate">Rest Is Playlists</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="items" orientation="vertical" />
      </template>

      <template #footer="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="footerItems" orientation="vertical" class="w-full" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
