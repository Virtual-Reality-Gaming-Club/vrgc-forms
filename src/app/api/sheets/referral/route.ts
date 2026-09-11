import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { subject, description } = body;

    if (!subject || !description) {
      return NextResponse.json(
        { success: false, error: 'Subject and description are required.' },
        { status: 400 }
      );
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_REFERRAL_URL;
    if (!scriptUrl) {
      return NextResponse.json(
        { success: true, warning: 'Referral Google Script URL is not configured on server.' },
        { status: 200 }
      );
    }

    const payload = {
      formType: body.formType || 'ticket',
      issueType: body.issueType || 'Technical',
      priority: body.priority || 'low',
      subject: String(subject).trim(),
      description: String(description).trim(),
      fileName: body.fileName || 'None',
    };

    try {
      await fetch(scriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr) {
      console.error('[Referral Sheets API] Google Script dispatch failed:', fetchErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Referral ticket submitted successfully to Google Sheets!',
    });
  } catch (err: any) {
    console.error('[Referral Sheets API] Internal error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to submit referral to Google Sheets' },
      { status: 500 }
    );
  }
}
