<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Playlists">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty icon="i-lucide-list-music" title="Coming soon" description="Ordered playlists with manual editing." />
    </template>
  </UDashboardPanel>
</template>
