<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty icon="i-lucide-settings" title="Coming soon" description="Spotify Client ID, AI provider keys and playlist preferences." />
    </template>
  </UDashboardPanel>
</template>
