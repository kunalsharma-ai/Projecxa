import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { FeatureGate, useOpenWeb } from '@/components/gate';
import { Card, GradientButton, LoadState, Muted, Pill, Progress, Screen, Segmented, statusTone } from '@/components/ui';
import { query } from '@/lib/api';
import { label } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useLoad } from '@/lib/use-load';

export interface ProjectRow {
  id: string;
  projectCode: string;
  workOrderNo: string | null;
  name: string;
  status: string;
  client: { id: string; name: string };
  projectManager: { id: string; name: string } | null;
  countries: string[];
  links: { live: number; total: number };
  targetCompletes: number;
  completes: number;
  terminates: number;
  overquotas: number;
  inProgress: number;
  irPercent: number | null;
  loiMinutes: number | null;
}

const STATUSES = ['', 'LIVE', 'TEST', 'HOLD', 'DRAFT', 'CLOSED', 'INVOICED'] as const;

export default function ProjectsScreen() {
  return (
    <FeatureGate feature="projects">
      <Projects />
    </FeatureGate>
  );
}

function Projects() {
  const { c } = useTheme();
  const { access } = useSession();
  const web = useOpenWeb();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);
  const list = useLoad<{ total: number; items: ProjectRow[] }>(`/projects${query({ status, q, pageSize: 50 })}`);

  return (
    <Screen title="Projects" subtitle={list.data ? `${list.data.total} projects` : undefined} scroll={false}>
      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.input, borderRadius: 14, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12 }}>
          <Feather name="search" size={16} color={c.faint} />
          <TextInput value={text} onChangeText={setText} placeholder="Search project ID, name, work order" placeholderTextColor={c.faint} accessibilityLabel="Search projects" style={{ flex: 1, color: c.text, paddingVertical: 11, fontSize: 15 }} autoCapitalize="none" />
        </View>
        <Segmented value={status} onChange={setStatus} options={STATUSES.map((s) => ({ value: s, label: s ? label(s) : 'All' }))} />
        {access.allowed.has('projects.create') && web.available && <GradientButton title="New project" icon="plus" onPress={() => web.open('/projects/new')} />}
      </View>
      <FlatList
        data={list.data?.items ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingTop: 6, gap: 12, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.reload} tintColor={c.primary} />}
        ListEmptyComponent={<LoadState loading={list.loading} error={list.error} onRetry={list.reload} empty emptyText={q || status ? 'No projects match.' : 'No projects yet.'} />}
        renderItem={({ item: p }) => <ProjectCard p={p} />}
      />
    </Screen>
  );
}

export function ProjectCard({ p }: { p: ProjectRow }) {
  const { c } = useTheme();
  const share = p.targetCompletes ? p.completes / p.targetCompletes : 0;
  return (
    <Card onPress={() => router.push(`/project/${p.id}`)} accessibilityLabel={`${p.projectCode} ${p.name}`} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: c.primary, fontWeight: '800', fontSize: 13 }}>{p.projectCode}</Text>
        <Pill tone={statusTone(p.status)}>{label(p.status)}</Pill>
      </View>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }} numberOfLines={2}>
        {p.name}
      </Text>
      <Muted>{[p.client?.name, p.countries.join(', '), p.projectManager?.name].filter(Boolean).join(' · ')}</Muted>
      <Progress value={share} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.muted, fontSize: 12 }}>{`${p.completes} / ${p.targetCompletes} completes`}</Text>
        <Text style={{ color: c.muted, fontSize: 12 }}>{`${p.links.live}/${p.links.total} links live`}</Text>
      </View>
    </Card>
  );
}
