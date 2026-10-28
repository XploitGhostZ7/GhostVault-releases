// By Kompilador
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BuscarPaciente } from '@/components/buscar-paciente';
import { PacienteForm } from '@/components/paciente-form';
import { tieneRol, useMe } from '@/components/session';
import { Encabezado, Modal } from '@/components/ui';

export default function PacientesPage() {
  const me = useMe();
  const router = useRouter();
  const [nuevo, setNuevo] = useState(false);
  const puedeCrear = tieneRol(me, 'admin', 'recepcion', 'medico');

  return (
    <>
      <Encabezado titulo="Pacientes" sub="Búsqueda por documento o nombre. Cada consulta queda registrada en auditoría.">
        {puedeCrear && (
          <button className="btn btn-primary" onClick={() => setNuevo(true)}>
            Nuevo paciente
          </button>
        )}
      </Encabezado>
      <section className="card">
        <BuscarPaciente accion="Abrir" onElegir={(p) => router.push(`/pacientes/${p.id}`)} />
      </section>
      <Modal titulo="Nuevo paciente" abierto={nuevo} onCerrar={() => setNuevo(false)}>
        <PacienteForm onGuardado={(p) => router.push(`/pacientes/${p.id}`)} />
      </Modal>
    </>
  );
}
