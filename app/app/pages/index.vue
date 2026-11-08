<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar title="Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty icon="i-lucide-layout-dashboard" title="Coming soon" description="Episode count, last fetch, unassigned episodes, Spotify status and next steps." />
    </template>
  </UDashboardPanel>
</template>
